import express from 'express'
import supabase from './config/db.js'
import { sendSMS } from './sms.js'
import './cron-jobs.js'
const app = express()

app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => {
  res.send('Hello World!')
})
app.post('/sms-response', async (req, res) => {
  console.log(req.body)
  const { From, Body } = req.body

  // Save response in Supabase
  await supabase
    .from('responses')
    .insert([{ phone_number: From, response: Body.trim() }])

  if (Body.trim().toUpperCase() === 'Y') {
    await sendSMS(From, 'Thank you! Have a wonderful day. Safe Not Sorry.')
    await supabase
      .from('check_ins')
      .update({ status: 'completed', completed_at: new Date() })
      .eq('phone_number', From)
      .order('created_at', { ascending: false }) // Assuming `created_at` exists
      .limit(1)
  }

 
})

app.listen(5000, () => console.log('🚀 Server running on port 3000'))
