const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const http = require("http");
const path = require('path');
const qrcode = require("qrcode");
const pino = require("pino");

const apiURL = "https://api.arv-serverless.workers.dev/v1/chat/completions";
const session = "baileys_auth_info";
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload({ createParentPath: true }));
app.use("/assets", express.static(path.join(__dirname, "client", "assets")));

app.get("/scan", (req, res) => res.sendFile(path.join(__dirname, "client", "server.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
let sock;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(session);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: isJidBroadcast,
    });
    store.bind(sock.ev);
    sock.multi = true;
    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", handleMessagesUpsert);
}

function handleConnectionUpdate(update) {
    const { connection, lastDisconnect } = update;
    switch (connection) {
        case 'close':
            handleConnectionClose(lastDisconnect.error);
            break;
        case 'open':
            console.log('opened connection');
            break;
        default:
            break;
    }
    if (update.qr) {
        qr = update.qr;
        updateQR("qr");
    } else if (!qr) {
        updateQR("loading");
    } else if (update.connection === "open") {
        updateQR("qrscanned");
    }
}

async function handleMessagesUpsert({ messages, type }) {
    if (type === "notify" && !messages[0].key.fromMe) {
        let pesan = messages[0].message.conversation || messages[0].message.extendedTextMessage?.text;
        const noWa = messages[0].key.remoteJid;
        console.log(`User: ${noWa}, ${JSON.stringify(messages[0], null, 2)}`);

        if (pesan === undefined || pesan === null || pesan === "") {
            //console.log('Received message is undefined, null, or an empty string, skipping processing.');
            return;
        }

        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                body: JSON.stringify({ messages: [{ role: "user", content: pesan }] }),
                headers: { 'Content-Type': 'application/json' },
            });
            if (response.ok) {
                const data = await response.json();
                const gptMessage = data.choices[0].message.content;
                await sock.readMessages([messages[0].key]);
                await sock.sendMessage(noWa, { text: gptMessage }, { quoted: messages[0] });
                //console.log(`Gemini: ${gptMessage}`);
            } else {
                console.error('Failed to fetch from ChatGPT:', response.statusText);
                await sock.sendMessage(noWa, { text: `Error: ${response.statusText}` }, { quoted: messages[0] });
            }
        } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(noWa, { text: `Error: ${error.message}` }, { quoted: messages[0] });
        }
    }
}

function handleConnectionClose(error) {
    const reason = new Boom(error).output.statusCode;
    switch (reason) {
        case DisconnectReason.badSession:
            console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
            sock.logout();
            break;
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.restartRequired:
        case DisconnectReason.timedOut:
            console.log("Reconnecting...");
            connectToWhatsApp();
            break;
        case DisconnectReason.connectionReplaced:
        case DisconnectReason.loggedOut:
            console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
            sock.logout();
            break;
        default:
            sock.end(`Unknown DisconnectReason: ${reason}|${error}`);
            break;
    }
}

function isConnected() {
    return !!sock.user;
}

function updateQR(status) {
    const statusMap = {
        "qr": () => {
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
        },
        "connected": () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
        },
        "qrscanned": () => {
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
        },
        "loading": () => {
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
        },
    };
    const updateFunction = statusMap[status];
    if (updateFunction) updateFunction();
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }

    // Handle incoming websocket requests
    socket.on("sendMessage", async (message) => {
        // Proses pesan yang diterima dari client
        console.log("Message received from client:", message);
        
        // Kirim pesan ke URL
        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                body: JSON.stringify({ message }),
                headers: { 'Content-Type': 'application/json' },
            });
            if (response.ok) {
                const responseData = await response.json();
                console.log("Response from fetch URL:", responseData);
                
                // Kirim balasan ke client
                soket.emit("messageResponse", responseData);
            } else {
                console.error('Failed to fetch from URL:', response.statusText);
                soket.emit("messageResponse", { error: response.statusText });
            }
        } catch (error) {
            console.error('Error:', error);
            soket.emit("messageResponse", { error: error.message });
        }
    });
});

connectToWhatsApp().catch(err => console.log("unexpected error: " + err));
server.listen(port, () => {
    console.log("Server Berjalan pada Port : " + port);
});
