import twilio from 'twilio'
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN)

export async function sendSMS (to, message) {
  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    })
    console.log(`✅ SMS sent to ${to}: ${message}`)
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${to}: ${error.message}`)
  }
}
