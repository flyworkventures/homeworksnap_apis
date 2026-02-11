# Homework Helper API

Bu API, nefes egzersizi API'sinden dönüştürülmüş bir Homework Helper uygulaması API'sidir. Auth sistemi korunmuş ve yeni özellikler eklenmiştir.

## Özellikler

1. **Fotoğraf ile Ödev Çözümü**: Kullanıcılar ödev fotoğrafı yükleyebilir, fotoğraf CDN'e kaydedilir ve n8n webhook'una gönderilir.
2. **Auto Scan ile Ödev Çözümü**: Otomatik tarama ile ödev verileri n8n webhook'una gönderilir.
3. **AI ile Sohbet**: Döküman tarandıktan sonra n8n workflow'una istek giderek AI ile sohbet yapılabilir.

## Veritabanı Şeması

SQL şeması `database/schema.sql` dosyasında bulunmaktadır.

### Tablolar

- **users**: Kullanıcı bilgileri (favorites_exercises ve premium_datas kaldırıldı)
- **chats**: AI sohbet kayıtları
- **chat_messages**: Chat mesajları (kullanıcı ve AI)
- **homework_images**: Fotoğraf ile yüklenen ödevler
- **homework_scans**: Auto scan ile taranan ödevler
- **refresh_tokens**: JWT refresh token'ları

## API Endpoints

### Authentication
- `POST /api/auth/signin` - Kullanıcı girişi/kaydı
- `POST /api/auth/refresh` - Token yenileme
- `POST /api/auth/logout` - Çıkış
- `GET /api/auth/me` - Kullanıcı bilgileri
- `PATCH /api/auth/me` - Profil güncelleme
- `POST /api/auth/me/photo` - Profil fotoğrafı yükleme
- `DELETE /api/auth/me/photo` - Profil fotoğrafı silme
- `DELETE /api/auth/me` - Hesap silme

### Homework Images
- `POST /api/homework/images` - Ödev fotoğrafı yükleme (multipart/form-data, field: "image")
- `GET /api/homework/images` - Kullanıcının ödev fotoğraflarını listeleme
- `GET /api/homework/images/:id` - Ödev fotoğrafı detayı
- `DELETE /api/homework/images/:id` - Ödev fotoğrafı silme

### Homework Scans
- `POST /api/homework/scans` - Auto scan oluşturma (Body: { scanData: Object })
- `GET /api/homework/scans` - Kullanıcının scan'lerini listeleme
- `GET /api/homework/scans/:id` - Scan detayı
- `DELETE /api/homework/scans/:id` - Scan silme

### Chats
- `GET /api/chats` - Kullanıcının chat'lerini listeleme
- `GET /api/chats/:id` - Chat detayı (mesajlarla birlikte)
- `POST /api/chats/:id/messages` - Chat'e mesaj gönderme (Body: { message: string })
- `PATCH /api/chats/:id` - Chat başlığını güncelleme (Body: { title: string })
- `PATCH /api/chats/:id/archive` - Chat'i arşivleme
- `DELETE /api/chats/:id` - Chat silme

## Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=homework_helper
DB_CONNECTION_LIMIT=10

# JWT
JWT_SECRET=your_jwt_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Bunny CDN
BUNNY_STORAGE_ZONE_NAME=your_storage_zone
BUNNY_STORAGE_ZONE_PASSWORD=your_storage_password
BUNNY_STORAGE_PATH=your-cdn-domain.b-cdn.net
BUNNY_PULL_ZONE=your_pull_zone

# n8n Webhooks
N8N_WEBHOOK_URL_HOMEWORK_IMAGE=https://your-n8n-instance.com/webhook/homework-image
N8N_WEBHOOK_URL_AUTO_SCAN=https://your-n8n-instance.com/webhook/auto-scan
N8N_WEBHOOK_URL_CHAT=https://your-n8n-instance.com/webhook/chat

# Server
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

## Flutter Modelleri

Flutter modelleri `flutter_models/` klasöründe bulunmaktadır:

- `user_model.dart` - User modeli
- `chat_model.dart` - Chat ve ChatMessage modelleri
- `homework_image_model.dart` - HomeworkImage modeli
- `homework_scan_model.dart` - HomeworkScan modeli
- `api_response_model.dart` - API response modelleri (ApiResponse, AuthResponse, Tokens)

## Kurulum

1. Bağımlılıkları yükleyin:
```bash
npm install
```

2. Veritabanını oluşturun ve şemayı uygulayın:
```bash
mysql -u your_user -p your_database < database/schema.sql
```

3. `.env` dosyasını oluşturun ve gerekli değişkenleri ayarlayın:
```bash
# Proje kök dizininde .env dosyası oluşturun
touch .env
```

`.env` dosyasına şu değişkenleri ekleyin:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=homework_helper
DB_CONNECTION_LIMIT=10

# JWT Configuration (ZORUNLU)
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d

# Bunny CDN Configuration
BUNNY_STORAGE_ZONE_NAME=your_storage_zone_name
BUNNY_STORAGE_ZONE_PASSWORD=your_storage_zone_password
BUNNY_STORAGE_PATH=your-cdn-domain.b-cdn.net
BUNNY_PULL_ZONE=your_pull_zone_name

# n8n Webhook URLs
N8N_WEBHOOK_URL_HOMEWORK_IMAGE=https://your-n8n-instance.com/webhook/homework-image
N8N_WEBHOOK_URL_AUTO_SCAN=https://your-n8n-instance.com/webhook/auto-scan
N8N_WEBHOOK_URL_CHAT=https://your-n8n-instance.com/webhook/chat

# Server Configuration
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

**ÖNEMLİ:** `JWT_SECRET` değişkeni zorunludur ve sunucu başlamadan önce ayarlanmalıdır!

4. Sunucuyu başlatın:
```bash
npm start
# veya development için
npm run dev
```

## n8n Webhook Formatları

### Homework Image Webhook
```json
{
  "imageUrl": "https://cdn.example.com/homework/image.jpg",
  "userId": "user_uid",
  "chatId": null,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Auto Scan Webhook
```json
{
  "scanData": { /* scanned data */ },
  "userId": "user_uid",
  "chatId": null,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Chat Message Webhook
```json
{
  "chatId": 123,
  "message": "Kullanıcı mesajı",
  "messageHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Notlar

- Auth sistemi korunmuştur ve aynı şekilde çalışmaktadır.
- Fotoğraflar Bunny CDN'e `homework/` klasörüne yüklenir.
- Profil fotoğrafları `profiles/` klasörüne yüklenir.
- n8n webhook'larından gelen yanıtlar otomatik olarak chat oluşturur ve mesajlar eklenir.
