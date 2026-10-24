const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');

// ── التحقق من المتغيرات المطلوبة عند الإقلاع ──────────────────────────────
const REQUIRED_ENV = ['BOT_TOKEN', 'GUILD_ID', 'CHANNEL_ID'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
    console.error(`❌ متغيرات مفقودة: ${missing.join(', ')}`);
    process.exit(1);
}

const config = {
    name:      process.env.BOT_NAME || 'NVR Bot',
    token:     process.env.BOT_TOKEN,
    guildId:   process.env.GUILD_ID,
    channelId: process.env.CHANNEL_ID,
};

// ── حالة الاتصال ───────────────────────────────────────────────────────────
let reconnectTimer  = null;
let isConnecting    = false;
let reconnectDelay  = 5_000;   // يبدأ بـ 5 ثواني
const MAX_DELAY     = 120_000; // أقصى حد 2 دقيقة

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// ── جدولة إعادة الاتصال مع Exponential Backoff ────────────────────────────
function scheduleReconnect(delay) {
    if (reconnectTimer) return;
    const wait = delay ?? reconnectDelay;
    console.log(`🔁 ${config.name}: إعادة المحاولة بعد ${wait / 1000}s`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, wait);
}

function resetDelay() { reconnectDelay = 5_000; }

function bumpDelay() {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
}

// ── الاتصال بالقناة الصوتية ────────────────────────────────────────────────
async function connect() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) {
            console.warn(`⚠️ ${config.name}: السيرفر مش موجود في الـ cache`);
            isConnecting = false; bumpDelay(); scheduleReconnect(); return;
        }

        const channel = guild.channels.cache.get(config.channelId);
        if (!channel) {
            console.warn(`⚠️ ${config.name}: القناة مش موجودة`);
            isConnecting = false; bumpDelay(); scheduleReconnect(); return;
        }

        // لو أصلاً في القناة الصح
        if (guild.members.me?.voice?.channelId === config.channelId) {
            console.log(`✅ ${config.name}: بالفعل في "${channel.name}"`);
            isConnecting = false; resetDelay(); return;
        }

        // تدمير أي connection قديم
        try { getVoiceConnection(config.guildId)?.destroy(); } catch { /* ignored */ }

        const conn = joinVoiceChannel({
            channelId:       config.channelId,
            guildId:         config.guildId,
            adapterCreator:  guild.voiceAdapterCreator,
            selfDeaf:        true,
            selfMute:        false,
        });

        await entersState(conn, VoiceConnectionStatus.Ready, 60_000);
        console.log(`✅ ${config.name}: اتصل بـ "${channel.name}"`);
        isConnecting = false;
        resetDelay();

        // ── مراقبة الـ connection بعد الاتصال ─────────────────────────────
        conn.on(VoiceConnectionStatus.Disconnected, async () => {
            console.warn(`⚠️ ${config.name}: انفصل - بحاول يرجع...`);
            try {
                // انتظر لو كان مجرد reconnect عابر
                await Promise.race([
                    entersState(conn, VoiceConnectionStatus.Signalling,  8_000),
                    entersState(conn, VoiceConnectionStatus.Connecting,  8_000),
                ]);
                // نجح الـ reconnect، انتظر حتى Ready
                await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
                console.log(`✅ ${config.name}: رجع للقناة`);
                resetDelay();
            } catch {
                conn.destroy();
                isConnecting = false;
                bumpDelay();
                scheduleReconnect();
            }
        });

        conn.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`🔴 ${config.name}: connection اتدمّر`);
            isConnecting = false;
            scheduleReconnect(5_000);
        });

    } catch (err) {
        console.error(`❌ ${config.name}:`, err.message);
        isConnecting = false;
        bumpDelay();
        scheduleReconnect();
    }
}

// ── أحداث الـ Client ────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
    console.log(`🟢 ${config.name}: جاهز - ${client.user.tag}`);
    setTimeout(() => connect(), 2_000);
});

// لو البوت اتطلع من القناة يرجع فوراً
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.member?.user?.id !== client.user?.id) return;

    const wasInOurChannel  = oldState.channelId === config.channelId;
    const isNowElsewhere   = newState.channelId !== config.channelId;

    if (wasInOurChannel && isNowElsewhere) {
        console.warn(`⚠️ ${config.name}: اتطرد من القناة - بيرجع...`);
        isConnecting = false;
        scheduleReconnect(2_000);
    }
});

// ── معالجة الأخطاء العامة ──────────────────────────────────────────────────
client.on('error', err => {
    console.error(`❌ ${config.name} client error:`, err.message);
});

client.on('warn', msg => {
    console.warn(`⚠️ ${config.name} warn:`, msg);
});

// Uncaught exceptions - يمنع البوت من الانهيار الصامت
process.on('uncaughtException', err => {
    console.error(`💥 uncaughtException:`, err.message);
    // لا نعمل exit - نخلي Fly.io يعيد التشغيل لو احتاج
});

process.on('unhandledRejection', (reason) => {
    console.error(`💥 unhandledRejection:`, reason);
});

// ── تسجيل الدخول ───────────────────────────────────────────────────────────
client.login(config.token).catch(err => {
    console.error(`❌ ${config.name}: فشل تسجيل الدخول -`, err.message);
    process.exit(1);
});
