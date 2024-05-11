## Untuk menginstal Node.js LTS (Long Term Support) di Ubuntu, Anda dapat mengikuti langkah-langkah berikut:

1. **Update Package Repository:**
   Pastikan paket repository sistem Anda diperbarui dengan menjalankan perintah berikut di terminal:

   ```
   sudo apt update
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
   nvm install 20.11.1
   npm install -g npm@latest
   sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
   ```

   Pastikan keduanya mengembalikan nomor versi yang diharapkan.

Dengan langkah-langkah di atas, Anda akan berhasil menginstal Node.js LTS di Ubuntu. Jika Anda menggunakan NVM, Anda juga dapat dengan mudah menginstal versi Node.js lain atau beralih antar versi yang telah diinstal.
