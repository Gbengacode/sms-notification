
import schedule from 'node-schedule'
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
    'Australia/Hobart'
  ],
  Central: ['Australia/Adelaide', 'Australia/Darwin'],
  Western: ['Australia/Perth', 'Africa/Lagos']
}

// 🔍 Find users due for check-in based on their timezone
async function getUsersDueForCheckIn () {
  const nowUtc = moment.utc()

  const { data: users, error } = await supabase
    .from('profiles')
    .select(
      'id, phone_number, first_name, timezone, check_in_time, checkin_pause_end_date'
    )

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
    // Check if pause date has expired or is null
    const pauseEndDate = user.checkin_pause_end_date
    if (pauseEndDate && userLocalTime.isBefore(pauseEndDate)) return false
    return userLocalTime.hour() === hour && userLocalTime.minute() === minute
  })
}

// 📩 Process check-ins and dynamically schedule reminders & escalations
async function processCheckIns () {
  const users = await getUsersDueForCheckIn()

  for (const user of users) {
    const { id: user_id, phone_number, first_name } = user
    const now = new Date()

    // Insert check-in record
    const { data: checkIn, error: checkInError } = await supabase
      .from('check_ins')
      .insert([
        {
          user_id,
          status: 'pending',
          phone_number,
          scheduled_for: now,
          initial_sms_sent_at: now
        }
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
      `Hi ${first_name}, this is your check in from Safe Not Sorry.  Please reply “Y” to this message so we know you’re safe and well.`
    )

    // Schedule the reminder in 15 minutes
    schedule.scheduleJob(new Date(now.getTime() + 2 * 60 * 1000), async () => {
      await processReminders(checkIn.id)
    })

    // Schedule the escalation in 45 minutes
    schedule.scheduleJob(new Date(now.getTime() + 4 * 60 * 1000), async () => {
      await processEscalations(checkIn.id)
    })

    console.log(`✅ Scheduled check-in for ${phone_number}`)
  }
}

// 📩 Send reminders 15 minutes after the initial check-in
async function processReminders (checkInId) {
  const now = new Date()

  const { data: checkIn, error } = await supabase
    .from('check_ins')
    .select('id, phone_number, user_id, reminder_sent_at, completed_at')
    .eq('id', checkInId)
    .single()

  if (error || !checkIn || checkIn.reminder_sent_at || checkIn.completed_at) {
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('first_name')
    .eq('id', checkIn.user_id)
    .single()

  if (profileError || !profile) return

  const { phone_number } = checkIn
  const { first_name } = profile

  await sendSMS(
    phone_number,
    `Hello ${first_name}, please respond “Y” as soon as possible.  If we don’t hear from you soon we will notify your emergency contact person`
  )

  await supabase
    .from('check_ins')
    .update({ reminder_sent_at: now })
    .eq('id', checkInId)

  console.log(`✅ Reminder sent to ${phone_number}`)
}

// 🚨 Escalate 45 minutes after the initial check-in
async function processEscalations (checkInId) {
  const now = new Date()

  const { data: checkIn, error } = await supabase
    .from('check_ins')
    .select('id, user_id, escalated_at, completed_at')
    .eq('id', checkInId)
    .single()

  if (error || !checkIn || checkIn.escalated_at || checkIn.completed_at) {
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('first_name')
    .eq('id', checkIn.user_id)
    .single()

  if (profileError || !profile) return

  const { first_name } = profile

  // Get emergency contact
  const { data: contact, error: contactError } = await supabase
    .from('emergency_contacts')
    .select('first_name, phone_number')
    .eq('user_id', checkIn.user_id)
    .order('priority', { ascending: true })
    .limit(1)
    .single()

  if (contactError || !contact) {
    console.warn(`⚠️ No emergency contact found for user ${checkIn.user_id}`)
    return
  }

  await sendSMS(
    contact.phone_number,
    `Hello ${contact.first_name}, you are a nominated contact for ${first_name}.  ${first_name} has not responded to their daily check in from Safe Not Sorry.  Please consider checking on them, thank you.`
  )

  await supabase
    .from('check_ins')
    .update({ escalated_at: now, status: 'escalated' })
    .eq('id', checkInId)

  console.log(`🚨 Escalation sent for ${first_name}`)
}

// 🕒 Schedule `processCheckIns` to run every minute
schedule.scheduleJob('* * * * *', async () => {
  console.log('⏳ Running scheduled check-in process...')
  await processCheckIns()
})
