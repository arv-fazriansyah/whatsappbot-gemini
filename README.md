### Panduan Instalasi WhatsApp Gemini di Termux

Berikut adalah panduan instalasi untuk menjalankan WhatsApp Gemini di Termux:

1. Perbarui paket Termux dengan perintah:
   ```
   pkg update
   ```

2. Instal Node.js LTS dengan menjalankan perintah berikut:
   ```
   pkg install nodejs-lts
   ```

3. Instal beberapa paket pendukung dengan perintah:
   ```
   pkg install curl wget nano git
   ```

4. Unduh repositori WhatsApp Gemini dengan menggunakan Git:
   ```
   git clone https://github.com/arv-fazriansyah/whatsappbot-gemini.git
   ```

5. Pindah ke direktori WhatsApp Gemini yang telah diunduh:
   ```
   cd whatsappbot-gemini/
   ```

6. Instal dependensi npm yang diperlukan dengan perintah:
   ```
   npm i
   ```

6. Instal dependensi npm yang diperlukan dengan perintah:
   ```
   cp .example.env .env
   ```
   Change your Gemini API_KEY [here](https://aistudio.google.com/app/apikey)
   ```
   API_KEY=YOUR_API_KEY
   ```
   
7. Terakhir, jalankan WhatsApp Gemini dengan perintah:
   ```
   npm run start
   ```

Setelah langkah-langkah di atas selesai, Anda seharusnya dapat menjalankan WhatsApp Gemini di Termux. Pastikan untuk mengikuti instruksi setiap langkah dengan cermat untuk memastikan instalasi yang berhasil. Jika ada masalah, pastikan bahwa semua dependensi telah diinstal dengan benar dan perintah-perintah dieksekusi tanpa kesalahan.
