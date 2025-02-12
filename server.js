import express from "express";
import supabase from "./config/db.js";
import { sendSMS } from "./sms.js";
import "./cron-jobs.js";
const app = express();

app.use(express.urlencoded({ extended: false }));

app.post("/sms-response", async (req, res) => {
    const { From, Body } = req.body;

    // Save response in Supabase
    await supabase.from("responses").insert([
        { phone_number: From, response: Body.trim() },
    ]);

    if (Body.trim().toUpperCase() === "Y") {
        await sendSMS(From, "Thank you! Have a wonderful day. Safe Not Sorry.");
        await supabase.from("checkins").update({ status: "completed" }).eq("phone_number", From);
    }

    res.sendStatus(200);
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
