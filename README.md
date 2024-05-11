## Untuk menginstal Node.js LTS (Long Term Support) di Ubuntu, Anda dapat mengikuti langkah-langkah berikut:

1. **Update Package Repository:**
   Pastikan paket repository sistem Anda diperbarui dengan menjalankan perintah berikut di terminal:

   ```
   sudo apt update
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
   nvm install 20.11.1
   npm install -g npm@latest
   ```

2. **Instal Node.js menggunakan NVM (Node Version Manager) (opsional):**
   NVM memungkinkan Anda untuk mengelola beberapa versi Node.js secara bersamaan. Jika Anda ingin menggunakan NVM, Anda dapat menginstalnya dengan menjalankan perintah berikut:

   ```
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   ```

   Setelah proses instalasi selesai, Anda mungkin perlu menutup dan membuka kembali terminal untuk memuat ulang file konfigurasi.

3. **Instal Node.js dengan apt:**
   Jika Anda tidak ingin menggunakan NVM dan ingin menginstal Node.js langsung, Anda dapat melakukannya menggunakan paket `nodejs` yang disediakan oleh repositori Ubuntu:

   ```
   sudo apt install nodejs npm && nvm install 14
   ```

   ```
   sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
   ```

   Ini juga akan menginstal npm, manajer paket untuk Node.js.

4. **Verifikasi Instalasi:**
   Setelah instalasi selesai, Anda dapat memeriksa versi Node.js yang terinstal dengan menjalankan perintah berikut:

   ```
   node -v
   ```

   Dan untuk memeriksa versi npm:

   ```
   npm -v
   ```

   Pastikan keduanya mengembalikan nomor versi yang diharapkan.

Dengan langkah-langkah di atas, Anda akan berhasil menginstal Node.js LTS di Ubuntu. Jika Anda menggunakan NVM, Anda juga dapat dengan mudah menginstal versi Node.js lain atau beralih antar versi yang telah diinstal.
