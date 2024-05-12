const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    useMultiFileAuthState} = require("@whiskeysockets/baileys");

const apiURL = "https://api.arv-serverless.workers.dev/v1/chat/completions"
const pino = require("pino");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const qrcode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const port = process.env.PORT || 8000;

app.use(express.static("client"));

app.get("/scan", (req, res) => {
    res.sendFile("client/server.html", {
        root: __dirname,
    });
});

app.get("/", (req, res) => {
    res.sendFile("client/index.html", {
        root: __dirname,
    });
});

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    let { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
        version,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
    store.bind(sock.ev);
    sock.multi = true
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new DisconnectReason(lastDisconnect.error).output.statusCode;
            switch (reason) {
                case DisconnectReason.badSession:
                    console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
                    sock.logout();
                    break;
                case DisconnectReason.connectionClosed:
                    console.log("Connection closed, reconnecting....");
                    connectToWhatsApp();
                    break;
                case DisconnectReason.connectionLost:
                    console.log("Connection Lost from Server, reconnecting...");
                    connectToWhatsApp();
                    break;
                case DisconnectReason.connectionReplaced:
                    console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
                    sock.logout();
                    break;
                case DisconnectReason.loggedOut:
                    console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
                    sock.logout();
                    break;
                case DisconnectReason.restartRequired:
                    console.log("Restart Required, Restarting...");
                    connectToWhatsApp();
                    break;
                case DisconnectReason.timedOut:
                    console.log("Connection TimedOut, Reconnecting...");
                    connectToWhatsApp();
                    break;
                default:
                    sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
                    break;
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            return;
        }
        if (update.qr) {
            qr = update.qr;
            updateQR("qr");
        }
        else if (qr === undefined) {
            updateQR("loading");
        }
        else {
            if (update.connection === "open") {
                updateQR("qrscanned");
                return;
            }
        }
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "notify" && !messages[0].key.fromMe) {
            const pesan = messages[0].message.conversation;
            const noWa = messages[0].key.remoteJid;
            await sock.readMessages([messages[0].key]);
            try {
                const response = await fetch(apiURL, {
                    method: 'POST',
                    body: JSON.stringify({ messages: [{ role: "user", content: pesan }] }),
                    headers: { 'Content-Type': 'application/json' },
                });
                if (response.ok) {
                    const data = await response.json();
                    const gptMessage = data.choices[0].message.content;
                    await sock.sendMessage(noWa, { text: gptMessage }, { quoted: messages[0] });
                } else {
                    console.error('Failed to fetch from ChatGPT:', response.statusText);
                    // Send error message to WhatsApp
                    await sock.sendMessage(noWa, { text: `Error: ${response.statusText}` }, { quoted: messages[0] });
                }
            } catch (error) {
                console.error('Error:', error);
                // Send error message to WhatsApp
                await sock.sendMessage(noWa, { text: `Error: ${error.message}` }, { quoted: messages[0] });
            }
        }
    });
}

io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");
    }
});

// functions
const isConnected = () => {
    return (sock.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

connectToWhatsApp().catch(err => console.log("unexpected error: " + err));
server.listen(port, () => {
    console.log("Server Berjalan pada Port : " + port);
});
