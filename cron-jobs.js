import cron from 'node-cron'
import supabase from './config/db.js'
import { sendSMS } from './sms.js'
import moment from 'moment-timezone'

// 🕒 Supported Australian Time Zones
const AU_TIMEZONES = {
  Eastern: [
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Canberra',
    'Australia/Hobart',
    'Australia/Sydney'
  ],
  Central: ['Australia/Adelaide', 'Australia/Darwin'],
  Western: ['Australia/Perth', 'Africa/Lagos']
}

// 🔍 Find users due for check-in based on their timezone
async function getUsersDueForCheckIn () {
  const nowUtc = moment.utc() // Get current UTC time

  const { data: users, error } = await supabase
    .from('profiles')
    .select('id, phone_number, first_name, timezone, check_in_time')

  if (error) {
    console.error('❌ Error fetching users:', error)
    return []
  }

  return users.filter(user => {
    if (!user.timezone || !user.check_in_time) return false

    const validTimezone = Object.values(AU_TIMEZONES)
      .flat()
      .includes(user.timezone)
    if (!validTimezone) return false

    const userLocalTime = nowUtc.clone().tz(user.timezone)
    const [hour, minute] = user.check_in_time.split(':').map(Number)

    return userLocalTime.hour() === hour && userLocalTime.minute() === minute
  })
}

// 📩 Process check-ins
async function processCheckIns () {
  const users = await getUsersDueForCheckIn()

  for (const user of users) {
    const { id: user_id, phone_number, first_name } = user

    // Create check-in record
    const { data: checkIn, error: checkInError } = await supabase
      .from('check_ins')
      .insert([
        { user_id, status: 'pending', phone_number, scheduled_for: new Date() }
      ])
      .select()
      .single()

    if (checkInError) {
      console.error(
        `❌ Error creating check-in for ${phone_number}:`,
        checkInError
      )
      continue
    }

    // Send initial check-in SMS
    await sendSMS(
      phone_number,
      `Hi ${first_name}, this is your Safe Not Sorry check-in. Reply “Y” to confirm you're safe.`
    )

    // Update check-in record with timestamp
    await supabase
      .from('check_ins')
      .update({ initial_sms_sent_at: new Date() })
      .eq('id', checkIn.id)

    // Schedule follow-up checks
    setTimeout(() => sendReminder(user, checkIn.id), 15 * 60 * 1000)
    setTimeout(() => escalateCheckIn(user, checkIn.id), 45 * 60 * 1000)
  }
}

// 📩 Send SMS reminder
async function sendReminder (user, check_in_id) {
  const { phone_number, first_name } = user

  const { data: latestResponse } = await supabase
    .from('check_ins')
    .select('completed_at')
    .eq('id', check_in_id)
    .single()

  if (latestResponse?.completed_at) return // User already checked in

  await sendSMS(phone_number, `Hello ${first_name}, please reply “Y” ASAP.`)
  await supabase
    .from('check_ins')
    .update({ reminder_sent_at: new Date() })
    .eq('id', check_in_id)
  console.log('remainder sent')
}

// 🚨 Escalate to emergency contact
async function escalateCheckIn (user, check_in_id) {
  const { id: user_id, first_name } = user

  const { data: checkIn } = await supabase
    .from('check_ins')
    .select('completed_at')
    .eq('id', check_in_id)
    .single()

  if (checkIn?.completed_at) return // User already responded

  const { data: contact } = await supabase
    .from('emergency_contacts')
    .select('first_name, phone_number')
    .eq('user_id', user_id)
    .order('priority', { ascending: true })
    .limit(1)
    .single()

  if (!contact) {
    console.warn(`⚠️ No emergency contact found for ${user_id}`)

    return
  }

  await sendSMS(
    contact.phone_number,
    `Hello ${contact.first_name}, ${first_name} hasn't responded. Please check on them.`
  )
  await supabase
    .from('check_ins')
    .update({ escalated_at: new Date(), status: 'escalated' })
    .eq('id', check_in_id)
  console.log('escalated sent')
}

// 🕒 Schedule Cron Job
cron.schedule('* * * * *', async () => {
  console.log('⏳ Running check-in process...')
  await processCheckIns()
})
