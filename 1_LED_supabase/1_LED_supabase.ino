/*
  健身房智能监控系统 v2.0
  ESP32 + OLED + 红外传感器 + DHT11 + MQTT + Supabase
  
  新增功能：同时通过 MQTT 和 Supabase REST API 发送数据
  - MQTT: 实时数据推送给小程序
  - Supabase REST API: 直接写入数据库，无需 Python 桥接脚本
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// ================= OLED配置 =================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ================= WiFi配置 =================
const char* ssid = "123";
const char* password = "12345678";

// ================= MQTT配置 =================
const char* mqttServer = "broker.emqx.io";
const int mqttPort = 1883;
const char* mqttTopic = "gym/status";
const char* mqttClientId = "gym-esp32-001";

WiFiClient espClient;
PubSubClient client(espClient);

// ================= Supabase配置 =================
const char* supabaseUrl = "https://aikgfrjvockpqhswingw.supabase.co";
const char* supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpa2dmcmp2b2NrcHFoc3dpbmd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjc4MzYsImV4cCI6MjA5MzY0MzgzNn0.lkoksXlLvwpjmpEZo4UFSy3_IAucU-b9Oky-I-yEmaU";

// ================= 引脚定义 =================
#define OLED_SCL 32
#define OLED_SDA 33

#define IR_ENTRANCE 17
#define IR_EXIT 16
#define IR_EQUIPMENT1 4
#define IR_EQUIPMENT2 5

#define DHT_PIN 13
#define DHTTYPE DHT11
DHT dht(DHT_PIN, DHTTYPE);

// ================= 系统参数 =================
#define MAX_PEOPLE 50
#define DEBOUNCE_TIME 800
#define SENSOR_READ_INTERVAL 5000
#define PUBLISH_INTERVAL 30000

// ================= 系统状态 =================
int currentPeople = 0;
int totalEntered = 0;
bool equipment1Occupied = false;
bool equipment2Occupied = false;
int equipment1UsageCount = 0;
int equipment2UsageCount = 0;
float temperature = 0.0;
float humidity = 0.0;

unsigned long lastEntranceTime = 0;
unsigned long lastExitTime = 0;
bool lastEntranceState = LOW;
bool lastExitState = LOW;

unsigned long lastSensorRead = 0;
unsigned long lastSerialOutput = 0;
unsigned long lastPublish = 0;

void connectWiFi() {
  Serial.print("Connecting WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");
    if (client.connect(mqttClientId)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" retry in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n\n=== Gym Monitor v2.0 (Supabase) ===");

  Wire.begin(OLED_SDA, OLED_SCL);

  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("OLED FAILED!");
    while (1) { delay(1000); }
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Gym Monitor v2.0");
  display.println("Supabase + MQTT");
  display.println("Initializing...");
  display.display();
  delay(2000);

  dht.begin();

  pinMode(IR_ENTRANCE, INPUT);
  pinMode(IR_EXIT, INPUT);
  pinMode(IR_EQUIPMENT1, INPUT);
  pinMode(IR_EQUIPMENT2, INPUT);

  lastEntranceState = digitalRead(IR_ENTRANCE);
  lastExitState = digitalRead(IR_EXIT);

  connectWiFi();
  
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Waiting for NTP time sync...");
  time_t now = time(nullptr);
  while (now < 8 * 3600 * 2) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\nNTP time synced!");
  
  client.setServer(mqttServer, mqttPort);

  Serial.println("System Ready!");
  updateDisplay();
}

void loop() {
  unsigned long currentTime = millis();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  checkEntrance();
  checkExit();
  checkEquipment();

  if (currentTime - lastSensorRead >= SENSOR_READ_INTERVAL) {
    lastSensorRead = currentTime;
    readEnvironment();
  }

  if (currentTime - lastSerialOutput >= SENSOR_READ_INTERVAL) {
    lastSerialOutput = currentTime;
    printStatus();
  }

  if (currentTime - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = currentTime;
    publishData();
  }

  updateDisplay();
  delay(50);
}

void checkEntrance() {
  bool currentState = digitalRead(IR_ENTRANCE);
  unsigned long currentTime = millis();

  if (currentState == LOW && lastEntranceState == HIGH) {
    if (currentTime - lastEntranceTime >= DEBOUNCE_TIME) {
      if (currentPeople < MAX_PEOPLE) {
        currentPeople++;
        totalEntered++;
        Serial.printf("Person entered. Current: %d, Total entered: %d\n", currentPeople, totalEntered);
      } else {
        Serial.println("Max capacity reached!");
      }
      lastEntranceTime = currentTime;
    }
  }
  lastEntranceState = currentState;
}

void checkExit() {
  bool currentState = digitalRead(IR_EXIT);
  unsigned long currentTime = millis();

  if (currentState == LOW && lastExitState == HIGH) {
    if (currentTime - lastExitTime >= DEBOUNCE_TIME) {
      if (currentPeople > 0) {
        currentPeople--;
        Serial.printf("Person exited. Total: %d\n", currentPeople);
      } else {
        Serial.println("Already at 0 people!");
      }
      lastExitTime = currentTime;
    }
  }
  lastExitState = currentState;
}

void checkEquipment() {
  bool eq1State = (digitalRead(IR_EQUIPMENT1) == LOW);
  bool eq2State = (digitalRead(IR_EQUIPMENT2) == LOW);

  if (eq1State != equipment1Occupied) {
    equipment1Occupied = eq1State;
    if (eq1State) { equipment1UsageCount++; }
    Serial.printf("Equipment 1: %s (Total uses: %d)\n", eq1State ? "OCCUPIED" : "FREE", equipment1UsageCount);
  }

  if (eq2State != equipment2Occupied) {
    equipment2Occupied = eq2State;
    if (eq2State) { equipment2UsageCount++; }
    Serial.printf("Equipment 2: %s (Total uses: %d)\n", eq2State ? "OCCUPIED" : "FREE", equipment2UsageCount);
  }
}

void readEnvironment() {
  float newHumidity = dht.readHumidity();
  float newTemperature = dht.readTemperature();

  if (!isnan(newHumidity)) { humidity = newHumidity; }
  if (!isnan(newTemperature)) { temperature = newTemperature; }

  if (isnan(newHumidity) || isnan(newTemperature)) {
    Serial.println("DHT11 read failed!");
  } else {
    Serial.printf("Temperature: %.1fC, Humidity: %.1f%%\n", temperature, humidity);
  }
}

void updateDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  display.printf("People: %d/%d", currentPeople, MAX_PEOPLE);

  display.setCursor(0, 10);
  display.printf("E1:%s  E2:%s",
                 equipment1Occupied ? "ON " : "OFF",
                 equipment2Occupied ? "ON " : "OFF");

  display.setCursor(0, 20);
  display.printf("T:%.1fC  H:%.0f%%", temperature, humidity);

  display.setCursor(0, 30);
  display.printf("E1:%d  E2:%d", equipment1UsageCount, equipment2UsageCount);

  display.setCursor(0, 50);
  display.printf("MQTT+Supabase");

  display.display();
}

void printStatus() {
  Serial.println("========== Status ==========");
  Serial.printf("People: %d/%d\n", currentPeople, MAX_PEOPLE);
  Serial.printf("Equipment 1: %s (Uses: %d)\n", equipment1Occupied ? "OCCUPIED" : "FREE", equipment1UsageCount);
  Serial.printf("Equipment 2: %s (Uses: %d)\n", equipment2Occupied ? "OCCUPIED" : "FREE", equipment2UsageCount);
  Serial.printf("Temperature: %.1fC\n", temperature);
  Serial.printf("Humidity: %.1f%%\n", humidity);
  Serial.println("============================");
}

void publishData() {
  publishMQTT();
  publishSupabase();
}

void publishMQTT() {
  StaticJsonDocument<256> obj;
  obj["deviceId"] = mqttClientId;
  obj["currentPeople"] = currentPeople;
  obj["maxPeople"] = MAX_PEOPLE;
  obj["equipment1"] = equipment1Occupied;
  obj["equipment2"] = equipment2Occupied;
  obj["equipment1Count"] = equipment1UsageCount;
  obj["equipment2Count"] = equipment2UsageCount;
  obj["temperature"] = temperature;
  obj["humidity"] = humidity;

  char payload[256];
  serializeJson(obj, payload);
  client.publish(mqttTopic, payload);
  Serial.printf("[MQTT] Published: %s\n", payload);
}

void publishSupabase() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi not connected, skip");
    return;
  }

  HTTPClient http;
  char url[128];
  snprintf(url, sizeof(url), "%s/rest/v1/gym_history", supabaseUrl);

  http.begin(url);
  http.addHeader("apikey", supabaseKey);
  http.addHeader("Authorization", supabaseKey);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<384> obj;
  obj["device_id"] = mqttClientId;
  obj["current_people"] = currentPeople;
  obj["total_entered"] = totalEntered;
  obj["max_people"] = MAX_PEOPLE;
  obj["temperature"] = temperature;
  obj["humidity"] = humidity;
  obj["equipment1"] = equipment1Occupied ? 1 : 0;
  obj["equipment2"] = equipment2Occupied ? 1 : 0;
  obj["equipment1_count"] = equipment1UsageCount;
  obj["equipment2_count"] = equipment2UsageCount;

  char payload[384];
  serializeJson(obj, payload);

  int httpCode = http.POST(payload);

  if (httpCode == 201 || httpCode == 200) {
    Serial.println("[Supabase] gym_history: OK");
  } else {
    Serial.printf("[Supabase] gym_history: FAILED (code=%d)\n", httpCode);
    String response = http.getString();
    Serial.printf("[Supabase] Response: %s\n", response.c_str());
  }
  http.end();

  updateSupabaseStatus();
}

void updateSupabaseStatus() {
  HTTPClient http;
  char url[128];
  snprintf(url, sizeof(url), "%s/rest/v1/gym_status?device_id=eq.%s", supabaseUrl, mqttClientId);

  http.begin(url);
  http.addHeader("apikey", supabaseKey);
  http.addHeader("Authorization", supabaseKey);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  time_t now = time(nullptr);
  char timeStr[32];
  strftime(timeStr, sizeof(timeStr), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

  StaticJsonDocument<512> obj;
  obj["current_people"] = currentPeople;
  obj["total_entered"] = totalEntered;
  obj["max_people"] = MAX_PEOPLE;
  obj["temperature"] = temperature;
  obj["humidity"] = humidity;
  obj["equipment1"] = equipment1Occupied ? 1 : 0;
  obj["equipment2"] = equipment2Occupied ? 1 : 0;
  obj["equipment1_count"] = equipment1UsageCount;
  obj["equipment2_count"] = equipment2UsageCount;
  obj["update_time"] = timeStr;

  char payload[512];
  serializeJson(obj, payload);

  int httpCode = http.PATCH(payload);

  if (httpCode == 200 || httpCode == 204) {
    Serial.println("[Supabase] gym_status: Updated");
  } else {
    Serial.printf("[Supabase] gym_status: FAILED (code=%d)\n", httpCode);
    String response = http.getString();
    Serial.printf("[Supabase] Response: %s\n", response.c_str());
  }
  http.end();
}
