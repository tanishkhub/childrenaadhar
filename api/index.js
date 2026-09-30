require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const jwt = require('jsonwebtoken')

const app = express()
app.use(cors())
app.use(express.json({ limit: '3mb' }))

const volunteerSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, unique: true }, active: { type: Boolean, default: true } }, { timestamps: true })
const donationSchema = new mongoose.Schema({
  volunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer', required: true },
  volunteerName: { type: String, required: true },
  type: { type: String, enum: ['cash', 'upi'], required: true },
  amount: { type: Number, required: true, min: 1 },
  receiptImage: { type: String, default: null },
  collectedAt: { type: Date, default: Date.now }
}, { timestamps: true })
const Volunteer = mongoose.models.Volunteer || mongoose.model('Volunteer', volunteerSchema)
const Donation = mongoose.models.Donation || mongoose.model('Donation', donationSchema)

let connection
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured')
  if (!connection) connection = mongoose.connect(process.env.MONGODB_URI)
  await connection
}
const secret = () => process.env.JWT_SECRET || 'change-this-before-production'
function requireAdmin(req, res, next) {
  try { req.admin = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret()); next() }
  catch { res.status(401).json({ error: 'Please sign in again.' }) }
}
function dateFilter(query) {
  const range = {}
  if (query.from) range.$gte = new Date(`${query.from}T00:00:00.000`)
  if (query.to) range.$lt = new Date(`${query.to}T23:59:59.999`)
  return Object.keys(range).length ? { collectedAt: range } : {}
}
async function seedVolunteers() {
  if (await Volunteer.countDocuments() === 0) await Volunteer.insertMany([{ name: 'Sonia' }, { name: 'Devika' }])
}

app.get('/api/health', async (req, res) => { try { await connect(); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/volunteers', async (req, res) => { try { await connect(); await seedVolunteers(); res.json(await Volunteer.find({ active: true }).sort({ name: 1 })) } catch (e) { res.status(500).json({ error: e.message }) } })
app.post('/api/donations', async (req, res) => {
  try {
    await connect()
    const { volunteerId, type, amount, receiptImage } = req.body
    const volunteer = await Volunteer.findOne({ _id: volunteerId, active: true })
    if (!volunteer || !['cash', 'upi'].includes(type) || !Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Please complete all required fields.' })
    if (type === 'upi' && (!receiptImage || !/^data:image\/jpeg;base64,/.test(receiptImage))) return res.status(400).json({ error: 'A valid UPI receipt image is required.' })
    const donation = await Donation.create({ volunteer: volunteer._id, volunteerName: volunteer.name, type, amount: Number(amount), receiptImage: type === 'upi' ? receiptImage : null })
    res.status(201).json({ donation })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/admin/login', (req, res) => {
  const password = process.env.ADMIN_PASSWORD
  if (!password) return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured.' })
  if (req.body.password !== password) return res.status(401).json({ error: 'Incorrect password.' })
  res.json({ token: jwt.sign({ role: 'admin' }, secret(), { expiresIn: '12h' }) })
})
app.get('/api/admin/volunteers', requireAdmin, async (req, res) => { try { await connect(); res.json(await Volunteer.find().sort({ active: -1, name: 1 })) } catch (e) { res.status(500).json({ error: e.message }) } })
app.post('/api/admin/volunteers', requireAdmin, async (req, res) => { try { await connect(); const name = req.body.name?.trim(); if (!name) return res.status(400).json({ error: 'Name is required.' }); res.status(201).json(await Volunteer.create({ name })) } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'This volunteer already exists.' : e.message }) } })
app.put('/api/admin/volunteers/:id', requireAdmin, async (req, res) => { try { await connect(); const name = req.body.name?.trim(); if (!name) return res.status(400).json({ error: 'Name is required.' }); const old = await Volunteer.findById(req.params.id); if (!old) return res.status(404).json({ error: 'Volunteer not found.' }); const volunteer = await Volunteer.findByIdAndUpdate(req.params.id, { name }, { new: true, runValidators: true }); await Donation.updateMany({ volunteer: volunteer._id }, { volunteerName: volunteer.name }); res.json(volunteer) } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'This volunteer already exists.' : e.message }) } })
app.delete('/api/admin/volunteers/:id', requireAdmin, async (req, res) => { try { await connect(); await Volunteer.findByIdAndUpdate(req.params.id, { active: false }); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    await connect(); const filter = dateFilter(req.query)
    const [totals, byVolunteer, recent] = await Promise.all([
      Donation.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ['$type', 'cash'] }, '$amount', 0] } }, upi: { $sum: { $cond: [{ $eq: ['$type', 'upi'] }, '$amount', 0] } } } }]),
      Donation.aggregate([{ $match: filter }, { $group: { _id: '$volunteerName', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
      Donation.find(filter).sort({ collectedAt: -1 }).limit(30).select('-receiptImage').lean()
    ])
    res.json({ totals: totals[0] || { total: 0, count: 0, cash: 0, upi: 0 }, byVolunteer, recent })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

if (require.main === module) app.listen(process.env.PORT || 3001, () => console.log('API running'))
module.exports = app
