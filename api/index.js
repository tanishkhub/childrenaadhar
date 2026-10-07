require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const app = express()
app.use(cors())
app.use(express.json({ limit: '3mb' }))

const volunteerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
  passwordHash: String,
  dailyTarget: { type: Number, default: 10000, min: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true })
const donationSchema = new mongoose.Schema({
  volunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'Volunteer', required: true, index: true },
  volunteerName: { type: String, required: true },
  type: { type: String, enum: ['cash', 'upi'], required: true },
  amount: { type: Number, required: true, min: 1 },
  receiptImage: { type: String, default: null },
  collectedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true })
const Volunteer = mongoose.models.Volunteer || mongoose.model('Volunteer', volunteerSchema)
const Donation = mongoose.models.Donation || mongoose.model('Donation', donationSchema)

let connection
async function connect() { if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured'); if (!connection) connection = mongoose.connect(process.env.MONGODB_URI); await connection }
const secret = () => process.env.JWT_SECRET || 'change-this-before-production'
function tokenFor(volunteer) { return jwt.sign({ role: 'volunteer', volunteerId: volunteer._id }, secret(), { expiresIn: '30d' }) }
function auth(role) { return (req, res, next) => { try { const user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret()); if (role && user.role !== role) throw new Error(); req.user = user; next() } catch { res.status(401).json({ error: 'Please sign in again.' }) } } }
function dayRange(date) { const start = date ? new Date(`${date}T00:00:00.000`) : new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return { start, end } }
function dateFilter(query, key = 'collectedAt') { const range = {}; if (query.from) range.$gte = new Date(`${query.from}T00:00:00.000`); if (query.to) range.$lt = new Date(`${query.to}T23:59:59.999`); return Object.keys(range).length ? { [key]: range } : {} }
function cleanVolunteer(v) { return { id: v._id, name: v.name, email: v.email, dailyTarget: v.dailyTarget, active: v.active } }
async function summaryFor(volunteerId, date) { const { start, end } = dayRange(date); const [today] = await Donation.aggregate([{ $match: { volunteer: new mongoose.Types.ObjectId(volunteerId), collectedAt: { $gte: start, $lt: end } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ['$type', 'cash'] }, '$amount', 0] } }, upi: { $sum: { $cond: [{ $eq: ['$type', 'upi'] }, '$amount', 0] } } } }])
  return today || { total: 0, count: 0, cash: 0, upi: 0 }
}
async function dailySeries(volunteerId, days = 30) {
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - days + 1)
  return Donation.aggregate([{ $match: { volunteer: new mongoose.Types.ObjectId(volunteerId), collectedAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$collectedAt', timezone: 'Asia/Kolkata' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }])
}

app.get('/api/health', async (req, res) => { try { await connect(); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.post('/api/auth/login', async (req, res) => { try { await connect(); const email = req.body.email?.trim().toLowerCase(); const volunteer = await Volunteer.findOne({ email, active: true }); if (!volunteer?.passwordHash || !await bcrypt.compare(req.body.password || '', volunteer.passwordHash)) return res.status(401).json({ error: 'Incorrect email or password.' }); res.json({ token: tokenFor(volunteer), volunteer: cleanVolunteer(volunteer) }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/me', auth('volunteer'), async (req, res) => { try { await connect(); const volunteer = await Volunteer.findById(req.user.volunteerId); if (!volunteer?.active) return res.status(401).json({ error: 'Account is unavailable.' }); res.json({ volunteer: cleanVolunteer(volunteer), today: await summaryFor(volunteer._id) }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.put('/api/me/target', auth('volunteer'), async (req, res) => { try { await connect(); const target = Number(req.body.dailyTarget); if (!Number.isFinite(target) || target < 0) return res.status(400).json({ error: 'Enter a valid daily target.' }); const volunteer = await Volunteer.findByIdAndUpdate(req.user.volunteerId, { dailyTarget: target }, { new: true }); res.json({ volunteer: cleanVolunteer(volunteer) }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.post('/api/donations', auth('volunteer'), async (req, res) => { try { await connect(); const { type, amount, receiptImage } = req.body; const volunteer = await Volunteer.findOne({ _id: req.user.volunteerId, active: true }); if (!volunteer || !['cash', 'upi'].includes(type) || !Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Please complete all required fields.' }); if (type === 'upi' && (!receiptImage || !/^data:image\/jpeg;base64,/.test(receiptImage))) return res.status(400).json({ error: 'A valid UPI receipt image is required.' }); const donation = await Donation.create({ volunteer: volunteer._id, volunteerName: volunteer.name, type, amount: Number(amount), receiptImage: type === 'upi' ? receiptImage : null }); res.status(201).json({ donation, today: await summaryFor(volunteer._id) }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/donations', auth('volunteer'), async (req, res) => { try { await connect(); const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 10)); const filter = { volunteer: req.user.volunteerId, ...dateFilter(req.query) }; if (['cash', 'upi'].includes(req.query.type)) filter.type = req.query.type; const [items, total] = await Promise.all([Donation.find(filter).sort({ collectedAt: -1 }).skip((page - 1) * limit).limit(limit).select('-receiptImage').lean(), Donation.countDocuments(filter)]); res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/me/progress', auth('volunteer'), async (req, res) => { try { await connect(); const volunteer = await Volunteer.findById(req.user.volunteerId); const days = await dailySeries(volunteer._id, 30); let streak = 0; for (let offset = 0; offset < 30; offset++) { const d = new Date(); d.setDate(d.getDate() - offset); const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); const found = days.find(row => row._id === key); if (found?.total >= volunteer.dailyTarget && volunteer.dailyTarget > 0) streak++; else break } res.json({ target: volunteer.dailyTarget, today: await summaryFor(volunteer._id), days, streak }) } catch (e) { res.status(500).json({ error: e.message }) } })

app.post('/api/admin/login', (req, res) => { const password = process.env.ADMIN_PASSWORD; if (!password) return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured.' }); if (req.body.password !== password) return res.status(401).json({ error: 'Incorrect password.' }); res.json({ token: jwt.sign({ role: 'admin' }, secret(), { expiresIn: '30d' }) }) })
app.get('/api/admin/volunteers', auth('admin'), async (req, res) => { try { await connect(); res.json((await Volunteer.find().sort({ active: -1, name: 1 })).map(cleanVolunteer)) } catch (e) { res.status(500).json({ error: e.message }) } })
app.post('/api/admin/volunteers', auth('admin'), async (req, res) => { try { await connect(); const { name, email, password, dailyTarget = 10000 } = req.body; if (!name?.trim() || !email?.trim() || !password || password.length < 6) return res.status(400).json({ error: 'Name, email, and a password of at least 6 characters are required.' }); const volunteer = await Volunteer.create({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12), dailyTarget: Number(dailyTarget) || 0 }); res.status(201).json(cleanVolunteer(volunteer)) } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'This email already exists.' : e.message }) } })
app.put('/api/admin/volunteers/:id', auth('admin'), async (req, res) => { try { await connect(); const update = {}; ['name', 'email', 'dailyTarget', 'active'].forEach(key => { if (req.body[key] !== undefined) update[key] = key === 'email' ? req.body[key].trim().toLowerCase() : req.body[key] }); if (req.body.password) update.passwordHash = await bcrypt.hash(req.body.password, 12); const old = await Volunteer.findById(req.params.id); if (!old) return res.status(404).json({ error: 'Volunteer not found.' }); const volunteer = await Volunteer.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }); if (update.name && update.name !== old.name) await Donation.updateMany({ volunteer: volunteer._id }, { volunteerName: volunteer.name }); res.json(cleanVolunteer(volunteer)) } catch (e) { res.status(400).json({ error: e.code === 11000 ? 'This email already exists.' : e.message }) } })
app.delete('/api/admin/volunteers/:id', auth('admin'), async (req, res) => { try { await connect(); await Volunteer.findByIdAndUpdate(req.params.id, { active: false }); res.json({ ok: true }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/admin/dashboard', auth('admin'), async (req, res) => { try { await connect(); const filter = dateFilter(req.query); const { start, end } = dayRange(); const [totals, volunteers, todayRows] = await Promise.all([Donation.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, cash: { $sum: { $cond: [{ $eq: ['$type', 'cash'] }, '$amount', 0] } }, upi: { $sum: { $cond: [{ $eq: ['$type', 'upi'] }, '$amount', 0] } } } }]), Volunteer.find().sort({ active: -1, name: 1 }).lean(), Donation.aggregate([{ $match: { collectedAt: { $gte: start, $lt: end } } }, { $group: { _id: '$volunteer', total: { $sum: '$amount' }, count: { $sum: 1 } } }])]); const progress = new Map(todayRows.map(x => [String(x._id), x])); res.json({ totals: totals[0] || { total: 0, count: 0, cash: 0, upi: 0 }, volunteers: volunteers.map(v => ({ ...cleanVolunteer(v), today: progress.get(String(v._id)) || { total: 0, count: 0 } })) }) } catch (e) { res.status(500).json({ error: e.message }) } })
app.get('/api/admin/volunteers/:id/detail', auth('admin'), async (req, res) => { try { await connect(); const volunteer = await Volunteer.findById(req.params.id); if (!volunteer) return res.status(404).json({ error: 'Volunteer not found.' }); const [days, donations] = await Promise.all([dailySeries(volunteer._id, 30), Donation.find({ volunteer: volunteer._id, ...dateFilter(req.query) }).sort({ collectedAt: -1 }).limit(100).lean()]); res.json({ volunteer: cleanVolunteer(volunteer), days, donations }) } catch (e) { res.status(500).json({ error: e.message }) } })

if (require.main === module) app.listen(process.env.PORT || 3001, () => console.log('API running'))
module.exports = app
