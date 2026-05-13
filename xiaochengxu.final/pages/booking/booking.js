const { supabaseRequest } = require('../../utils/supabase')

Page({
  data: {
    username: '',
    selectedEquipment: null,
    selectedDate: '',
    selectedTimeSlot: null,
    selectedTimeSlotLabel: '',
    timeSlots: [],
    myBookings: [],
    canSubmit: false,
    minDate: new Date().toISOString().split('T')[0],
    maxDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  },

  onLoad() {
    this.loadUsername()
    this.loadTimeSlots()
    this.setDefaultDate()
  },

  onShow() {
    if (this.data.username) {
      this.loadMyBookings()
    }
  },

  loadUsername() {
    try {
      const username = wx.getStorageSync('gym_username')
      if (username) {
        this.setData({ username })
      }
    } catch (e) {
      console.error('加载用户名失败:', e)
    }
  },

  loadTimeSlots() {
    const hours = ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
                  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
                  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
                  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']
    const timeSlots = hours.map((hour, index) => ({
      id: index + 1,
      startTime: hour,
      endTime: hours[index + 1] || '24:00',
      label: `${hour}-${hours[index + 1] || '24:00'}`,
      isBooked: false
    }))
    this.setData({ timeSlots })
  },

  setDefaultDate() {
    const today = new Date().toISOString().split('T')[0]
    this.setData({ selectedDate: today })
  },

  onUsernameInput(e) {
    const username = e.detail.value.trim()
    this.setData({ username })
    wx.setStorageSync('gym_username', username)
    if (username) {
      this.loadMyBookings()
    }
  },

  selectEquipment(e) {
    const equipment = parseInt(e.currentTarget.dataset.equipment)
    this.setData({
      selectedEquipment: equipment,
      selectedTimeSlot: null,
      selectedTimeSlotLabel: ''
    })
    this.checkEquipmentBookings(equipment)
    this.updateSubmitStatus()
  },

  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value })
    if (this.data.selectedEquipment) {
      this.checkEquipmentBookings(this.data.selectedEquipment)
    }
    this.updateSubmitStatus()
  },

  selectTimeSlot(e) {
    const slot = e.currentTarget.dataset.slot
    if (slot.isBooked) {
      wx.showToast({ title: '该时段已被预约', icon: 'none' })
      return
    }
    this.setData({
      selectedTimeSlot: slot.id,
      selectedTimeSlotLabel: slot.label
    })
    this.updateSubmitStatus()
  },

  async checkEquipmentBookings(equipmentId) {
    if (!this.data.selectedDate) return
    try {
      const result = await supabaseRequest('gym_bookings', 'GET', {
        query: {
          equipment_id: equipmentId,
          booking_date: this.data.selectedDate,
          status: ['confirmed', 'pending']
        },
        select: 'start_time,end_time,username'
      })

      if (result.success && result.data) {
        const bookedSlots = result.data
        const timeSlots = this.data.timeSlots.map(slot => {
          const isBooked = bookedSlots.some(booked =>
            booked.start_time && booked.start_time.substring(0, 5) === slot.startTime
          )
          return { ...slot, isBooked }
        })
        this.setData({ timeSlots })
      }
    } catch (e) {
      console.error('检查预约失败:', e)
    }
  },

  async loadMyBookings() {
    if (!this.data.username) return
    try {
      const result = await supabaseRequest('gym_bookings', 'GET', {
        query: { username: this.data.username, status: ['confirmed', 'pending'] },
        select: '*'
      })

      if (result.success && result.data) {
        this.setData({
          myBookings: result.data.map(b => ({
            ...b,
            equipmentName: `器械${b.equipment_id}`,
            startTime: b.start_time ? b.start_time.substring(0, 5) : '--',
            endTime: b.end_time ? b.end_time.substring(0, 5) : '--',
            bookingDate: b.booking_date
          }))
        })
      }
    } catch (e) {
      console.error('加载预约列表失败:', e)
      this.setData({ myBookings: [] })
    }
  },

  updateSubmitStatus() {
    const { username, selectedEquipment, selectedDate, selectedTimeSlot } = this.data
    const canSubmit = !!(username && selectedEquipment && selectedDate && selectedTimeSlot)
    this.setData({ canSubmit })
  },

  async submitBooking() {
    const { username, selectedEquipment, selectedDate, selectedTimeSlot } = this.data

    if (!username) {
      wx.showModal({
        title: '提示',
        content: '请先输入用户名',
        showCancel: false
      })
      return
    }

    if (!selectedEquipment || !selectedDate || !selectedTimeSlot) {
      wx.showToast({ title: '请完善预约信息', icon: 'none' })
      return
    }

    try {
      wx.showLoading({ title: '预约中...' })
      const selectedSlot = this.data.timeSlots.find(slot => slot.id === selectedTimeSlot)

      const startParts = selectedSlot.startTime.split(':')
      const endH = parseInt(startParts[0]) + 1
      const endTime = String(endH).padStart(2, '0') + ':' + startParts[1]

      const userResult = await supabaseRequest('gym_users', 'GET', {
        query: { username },
        select: 'id'
      })

      if (!userResult.success || !userResult.data || userResult.data.length === 0) {
        wx.hideLoading()
        wx.showToast({ title: '用户不存在，请先注册', icon: 'none' })
        return
      }

      const userId = userResult.data[0].id

      const result = await supabaseRequest('gym_bookings', 'POST', {
        data: {
          user_id: userId,
          username,
          equipment_id: selectedEquipment,
          booking_date: selectedDate,
          start_time: selectedSlot.startTime,
          end_time: endTime,
          status: 'confirmed'
        }
      })

      wx.hideLoading()

      if (result.success) {
        wx.showToast({ title: '预约成功', icon: 'success' })
        this.setData({
          selectedEquipment: null,
          selectedTimeSlot: null,
          selectedTimeSlotLabel: ''
        })
        this.loadMyBookings()
        this.checkEquipmentBookings(selectedEquipment)
      }
    } catch (e) {
      wx.hideLoading()
      console.error('预约失败:', e)
      wx.showToast({ title: '预约失败，请重试', icon: 'none' })
    }
  },

  async cancelBooking(e) {
    const bookingId = e.currentTarget.dataset.id
    try {
      const res = await wx.showModal({
        title: '确认取消',
        content: '确定要取消这个预约吗？'
      })
      if (!res.confirm) return

      wx.showLoading({ title: '取消中...' })

      const result = await supabaseRequest('gym_bookings', 'PATCH', {
        id: bookingId,
        data: { status: 'cancelled' }
      })

      wx.hideLoading()

      if (result.success) {
        wx.showToast({ title: '已取消预约', icon: 'success' })
        this.loadMyBookings()
      }
    } catch (e) {
      wx.hideLoading()
      console.error('取消预约失败:', e)
      wx.showToast({ title: '取消失败', icon: 'none' })
    }
  },

  goToRegister() {
    wx.showModal({
      title: '注册提示',
      content: '请使用浏览器访问网页进行注册',
      showCancel: false
    })
  }
})
