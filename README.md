### Panduan Instalasi WhatsApp Gemini di Termux

Berikut adalah panduan instalasi untuk menjalankan WhatsApp Gemini di Termux:

1. Perbarui paket Termux dengan perintah:
   ```bash
   pkg update
   ```

2. Instal Node.js LTS dengan menjalankan perintah berikut:
   ```bash
   pkg install nodejs-lts
   ```

3. Instal beberapa paket pendukung dengan perintah:
   ```bash
   pkg install curl wget nano git
   ```

4. Unduh repositori WhatsApp Gemini dengan menggunakan Git:
   ```bash
   git clone https://github.com/arv-fazriansyah/whatsappbot-gemini.git
   ```

5. Pindah ke direktori WhatsApp Gemini yang telah diunduh:
   ```bash
   cd whatsappbot-gemini/
   ```

6. Instal dependensi npm yang diperlukan dengan perintah:
   ```bash
   npm i
   ```

7. Salin file `.example.env` menjadi `.env`:
   ```bash
   cp .example.env .env
   ```
   Kemudian ubah nilai variabel `API_KEY` dengan API_KEY yang Anda dapatkan dari [Google AI Studio](https://aistudio.google.com/app/apikey):
   ```bash
   API_KEY=YOUR_API_KEY
   ```

8. Terakhir, jalankan WhatsApp Gemini dengan perintah:
   ```bash
   npm run start
   ```

Setelah langkah-langkah di atas selesai, Anda seharusnya dapat menjalankan WhatsApp Gemini di Termux. Pastikan untuk mengikuti instruksi setiap langkah dengan cermat untuk memastikan instalasi yang berhasil. Jika ada masalah, pastikan bahwa semua dependensi telah diinstal dengan benar dan perintah-perintah dieksekusi tanpa kesalahan.
