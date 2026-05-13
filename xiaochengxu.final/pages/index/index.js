// index.js
// MQTT获取实时数据 + Supabase获取预约数据

const mqtt = require('../../utils/mqtt.js')
const { supabaseRequest } = require('../../utils/supabase')

const MQTT_BROKER = 'broker.emqx.io'
const MQTT_PORT = 8084
const MQTT_TOPIC_STATUS = 'gym/status'

Page({
  data: {
    currentPeople: 0,
    maxPeople: 50,
    progressPercent: 0,
    temperature: '--',
    humidity: '--',
    equipment1: false,
    equipment2: false,
    equipment1Count: 0,
    equipment2Count: 0,
    eq1Last10min: 0,
    eq1Last1hour: 0,
    eq2Last10min: 0,
    eq2Last1hour: 0,
    equipment1Bookings: [],
    equipment2Bookings: [],
    bookingDate: '',
    online: false,
    mqttConnected: false,
    lastUpdateTime: '--:--:--'
  },

  dataTimer: null,
  mqttClient: null,
  bookingTimer: null,

  historyCache: {
    equipment1: [],
    equipment2: []
  },

  onLoad() {
    console.log('健身房监控小程序加载')
    this.loadHistoryFromCache()
    this.connectMQTT()
    this.loadBookingsFromSupabase()
    
    this.bookingTimer = setInterval(() => {
      this.loadBookingsFromSupabase()
    }, 30000)

    setInterval(() => {
      this.cleanExpiredHistory()
    }, 60000)
  },

  onShow() {
    this.loadBookingsFromSupabase()
  },

  onUnload() {
    if (this.dataTimer) {
      clearInterval(this.dataTimer)
    }
    if (this.mqttClient) {
      this.mqttClient.end()
    }
    if (this.bookingTimer) {
      clearInterval(this.bookingTimer)
    }
  },

  connectMQTT() {
    const that = this
    const clientId = 'wx_mini_' + Math.random().toString(16).substr(2, 8)
    const wsUrl = `wxs://${MQTT_BROKER}:${MQTT_PORT}/mqtt`

    console.log('[MQTT] Connecting to:', wsUrl)

    try {
      const client = mqtt.connect(wsUrl, {
        clientId: clientId,
        keepalive: 60,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30 * 1000,
        transformWsUrl: function (url, options, client) {
          return url
        }
      })

      client.on('connect', () => {
        console.log('[MQTT] Connected!')
        that.setData({ mqttConnected: true })

        client.subscribe(MQTT_TOPIC_STATUS, (err) => {
          if (err) {
            console.error('[MQTT] Subscribe status failed:', err)
          } else {
            console.log('[MQTT] Subscribed to:', MQTT_TOPIC_STATUS)
          }
        })
      })

      client.on('message', (topic, payload) => {
        console.log('[MQTT] Message received, topic:', topic)

        try {
          const data = JSON.parse(payload.toString())
          console.log('[MQTT] Payload:', data)

          if (topic === MQTT_TOPIC_STATUS) {
            that.recordUsage('equipment1', data.equipment1Count || data.equipment1_count || 0)
            that.recordUsage('equipment2', data.equipment2Count || data.equipment2_count || 0)

            const stats1 = that.calculateStats('equipment1')
            const stats2 = that.calculateStats('equipment2')
            const currentPeople = data.currentPeople !== undefined ? data.currentPeople : (data.current_people || 0)
            const maxPeople = data.maxPeople !== undefined ? data.maxPeople : (data.max_people || 50)

            that.setData({
              online: true,
              currentPeople,
              maxPeople,
              temperature: data.temperature !== undefined && data.temperature !== null ? parseFloat(data.temperature).toFixed(1) : '--',
              humidity: data.humidity !== undefined && data.humidity !== null ? parseFloat(data.humidity).toFixed(0) : '--',
              equipment1: !!data.equipment1,
              equipment2: !!data.equipment2,
              equipment1Count: data.equipment1Count !== undefined ? data.equipment1Count : (data.equipment1_count || 0),
              equipment2Count: data.equipment2Count !== undefined ? data.equipment2Count : (data.equipment2_count || 0),
              eq1Last10min: stats1.last10min,
              eq1Last1hour: stats1.last1hour,
              eq2Last10min: stats2.last10min,
              eq2Last1hour: stats2.last1hour,
              progressPercent: maxPeople > 0 ? Math.min((currentPeople / maxPeople) * 100, 100) : 0,
              lastUpdateTime: data.updateTime || data.update_time || that.getCurrentTime()
            })
            console.log('[MQTT] Gym status updated')
          }
        } catch (e) {
          console.error('[MQTT] Parse error:', e)
        }
      })

      client.on('error', (err) => {
        console.error('[MQTT] Error:', err)
        that.setData({ mqttConnected: false })
      })

      client.on('close', () => {
        console.log('[MQTT] Connection closed')
        that.setData({ mqttConnected: false })
      })

      client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...')
      })

      this.mqttClient = client

    } catch (e) {
      console.error('[MQTT] Connect error:', e)
    }
  },

  async loadBookingsFromSupabase() {
    try {
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const nextWeek = `${nextWeekDate.getFullYear()}-${String(nextWeekDate.getMonth() + 1).padStart(2, '0')}-${String(nextWeekDate.getDate()).padStart(2, '0')}`
      
      console.log('[Supabase] Today (local):', today, 'NextWeek:', nextWeek)
      
      const result = await supabaseRequest('gym_bookings', 'GET', {
        query: { status: ['confirmed', 'pending'] },
        gte: { booking_date: today },
        lte: { booking_date: nextWeek },
        select: 'equipment_id,start_time,end_time,username,status,booking_date'
      })

      if (result.success && result.data) {
        const equipment1Bookings = []
        const equipment2Bookings = []

        result.data.forEach(b => {
          const bookingInfo = {
            startTime: b.start_time ? b.start_time.substring(0, 5) : '--',
            endTime: b.end_time ? b.end_time.substring(0, 5) : '--',
            username: b.username,
            status: b.status || 'confirmed',
            date: b.booking_date || today
          }
          
          if (b.equipment_id === 1 || b.equipment_id === '1') {
            equipment1Bookings.push(bookingInfo)
          } else {
            equipment2Bookings.push(bookingInfo)
          }
        })

        this.setData({
          equipment1Bookings,
          equipment2Bookings,
          bookingDate: today
        })
        console.log('[Supabase] Bookings loaded:', equipment1Bookings.length, equipment2Bookings.length)
      } else {
        this.setData({
          equipment1Bookings: [],
          equipment2Bookings: [],
          bookingDate: today
        })
      }
    } catch (e) {
      console.error('[Supabase] Load bookings error:', e)
      this.setData({
        equipment1Bookings: [],
        equipment2Bookings: []
      })
    }
  },

  getCurrentTime() {
    const now = new Date()
    const h = now.getHours().toString().padStart(2, '0')
    const m = now.getMinutes().toString().padStart(2, '0')
    const s = now.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  },

  resetPeopleCount() {
    wx.showToast({
      title: '当前版本未接入重置命令',
      icon: 'none',
      duration: 2000
    })
  },

  recordUsage(equipment, totalCount) {
    const now = Date.now()
    const history = this.historyCache[equipment]
    const lastRecord = history.length > 0 ? history[history.length - 1] : null

    if (!lastRecord || totalCount > lastRecord.count) {
      history.push({
        time: now,
        count: totalCount
      })
      this.saveHistoryToCache()
    }
  },

  calculateStats(equipment) {
    const now = Date.now()
    const history = this.historyCache[equipment]
    const tenMinAgo = now - 10 * 60 * 1000
    const oneHourAgo = now - 60 * 60 * 1000

    let last10min = 0
    let last1hour = 0

    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i]
      if (record.time >= tenMinAgo) {
        last10min++
      }
      if (record.time >= oneHourAgo) {
        last1hour++
      } else {
        break
      }
    }

    return { last10min, last1hour }
  },

  loadHistoryFromCache() {
    try {
      const data = wx.getStorageSync('gym_history_cache')
      if (data) {
        this.historyCache = data
        console.log('历史数据已加载:', this.historyCache)
      }
    } catch (e) {
      console.error('加载缓存失败:', e)
    }
  },

  saveHistoryToCache() {
    try {
      wx.setStorageSync('gym_history_cache', this.historyCache)
    } catch (e) {
      console.error('保存缓存失败:', e)
    }
  },

  cleanExpiredHistory() {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    let needSave = false

    for (const equipment of ['equipment1', 'equipment2']) {
      const history = this.historyCache[equipment]
      const originalLength = history.length

      this.historyCache[equipment] = history.filter(record => {
        return record.time >= oneHourAgo
      })

      if (history.length !== originalLength) {
        needSave = true
      }
    }

    if (needSave) {
      this.saveHistoryToCache()
      console.log('已清理过期数据')
    }
  }
})
