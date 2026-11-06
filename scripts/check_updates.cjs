const botToken = "9295576468:AAEDkx2sZBzfxGSnOMFprvhwHIOQ4pD_xmQ";

async function run() {
    const res = await fetch("https://api.telegram.org/bot" + botToken + "/getUpdates?limit=40");
    const d = await res.json();
    console.log("UPDATES COUNT:", d.result ? d.result.length : 0);
    if (d.result) {
        for (const u of d.result) {
            const m = u.message || u.edited_message;
            const cb = u.callback_query;
            if (m) console.log("MSG", u.update_id, "thread=" + m.message_thread_id, JSON.stringify(m.text));
            if (cb) console.log("CB", u.update_id, "thread=" + (cb.message ? cb.message.message_thread_id : null), "data=" + cb.data);
        }
    }
}
run();
