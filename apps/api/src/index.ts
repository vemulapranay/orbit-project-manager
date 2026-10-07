import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { PrismaClient, Priority, ProjectStatus, TaskStatus } from '@prisma/client';
import { z, ZodError } from 'zod';

const app = express();
const db = new PrismaClient();
const port = Number(process.env.PORT || 4000);
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
app.use(helmet());
app.use(cors({ origin: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => { console.info(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const registerSchema = z.object({ fullName: z.string().trim().min(2).max(100), email, password: z.string().min(8).max(128) });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const projectFields = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(''), status: z.nativeEnum(ProjectStatus).default('NOT_STARTED'), startDate: z.string().datetime().nullable().optional(), endDate: z.string().datetime().nullable().optional() });
const validProjectDates = <T extends { startDate?: string | null; endDate?: string | null }>(value: T) => !value.startDate || !value.endDate || new Date(value.endDate) >= new Date(value.startDate);
const projectSchema = projectFields.refine(validProjectDates, { message: 'End date must be on or after start date', path: ['endDate'] });
const projectPatchSchema = projectFields.partial().refine(validProjectDates, { message: 'End date must be on or after start date', path: ['endDate'] });
const taskSchema = z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(160), description: z.string().max(2000).default(''), status: z.nativeEnum(TaskStatus).default('PENDING'), priority: z.nativeEnum(Priority).default('MEDIUM'), dueDate: z.string().datetime().nullable().optional() });
const projectFilterSchema = z.object({ status: z.nativeEnum(ProjectStatus).optional(), search: z.string().trim().max(120).optional() });
const taskFilterSchema = z.object({ status: z.nativeEnum(TaskStatus).optional(), priority: z.nativeEnum(Priority).optional(), search: z.string().trim().max(120).optional(), projectId: z.string().optional() });
type AuthedRequest = Request & { auth?: { userId: string; jti: string; exp: number } };
const wrap = (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
const auth = wrap(async (req, res, next) => {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    const p = jwt.verify(value.slice(7), secret!) as JwtPayload;
    if (typeof p.sub !== 'string' || typeof p.jti !== 'string' || typeof p.exp !== 'number') throw new Error('Invalid token');
    if (await db.revokedToken.findUnique({ where: { jti: p.jti } })) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    req.auth = { userId: p.sub, jti: p.jti, exp: p.exp }; next();
  } catch { return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
});
const issueToken = (userId: string) => jwt.sign({}, secret!, { subject: userId, jwtid: randomUUID(), expiresIn: '7d' });
const safeUser = (user: { id: string; fullName: string; email: string; createdAt: Date }) => ({ id: user.id, fullName: user.fullName, email: user.email, createdAt: user.createdAt });
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/auth/register', authLimit, wrap(async (req, res) => {
  const data = registerSchema.parse(req.body);
  if (await db.user.findUnique({ where: { email: data.email } })) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = await db.user.create({ data: { fullName: data.fullName, email: data.email, passwordHash: await bcrypt.hash(data.password, 12) } });
  res.status(201).json({ user: safeUser(user), token: issueToken(user.id) });
}));
app.post('/api/auth/login', authLimit, wrap(async (req, res) => {
  const data = loginSchema.parse(req.body); const user = await db.user.findUnique({ where: { email: data.email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect' });
  res.json({ user: safeUser(user), token: issueToken(user.id) });
}));
app.post('/api/auth/logout', auth, wrap(async (req, res) => { await db.revokedToken.create({ data: { jti: req.auth!.jti, userId: req.auth!.userId, expiresAt: new Date(req.auth!.exp * 1000) } }); res.status(204).end(); }));
app.get('/api/auth/me', auth, wrap(async (req, res) => { const user = await db.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, fullName: true, email: true, createdAt: true } }); if (!user) return res.status(401).json({ error: 'Account not found' }); res.json({ user }); }));
app.get('/api/projects', auth, wrap(async (req, res) => {
  const { status, search } = projectFilterSchema.parse(req.query);
  res.json(await db.project.findMany({ where: { ownerId: req.auth!.userId, ...(status ? { status } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }, include: { _count: { select: { tasks: true } } }, orderBy: { updatedAt: 'desc' } }));
}));
app.get('/api/projects/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const p = await db.project.findFirst({ where: { id, ownerId: req.auth!.userId }, include: { tasks: { orderBy: { createdAt: 'desc' } } } }); if (!p) return res.status(404).json({ error: 'Project not found' }); res.json(p); }));
app.post('/api/projects', auth, wrap(async (req, res) => { const d = projectSchema.parse(req.body); res.status(201).json(await db.project.create({ data: { ...d, ownerId: req.auth!.userId, startDate: d.startDate ? new Date(d.startDate) : null, endDate: d.endDate ? new Date(d.endDate) : null } })); }));
app.put('/api/projects/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const d = projectPatchSchema.parse(req.body); const result = await db.project.updateMany({ where: { id, ownerId: req.auth!.userId }, data: { ...d, ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : null } : {}), ...(d.endDate !== undefined ? { endDate: d.endDate ? new Date(d.endDate) : null } : {}) } }); if (!result.count) return res.status(404).json({ error: 'Project not found' }); res.json(await db.project.findUnique({ where: { id } })); }));
app.delete('/api/projects/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const result = await db.project.deleteMany({ where: { id, ownerId: req.auth!.userId } }); if (!result.count) return res.status(404).json({ error: 'Project not found' }); res.status(204).end(); }));
app.get('/api/tasks', auth, wrap(async (req, res) => {
  const { status, priority, search, projectId } = taskFilterSchema.parse(req.query);
  res.json(await db.task.findMany({ where: { project: { ownerId: req.auth!.userId }, ...(projectId ? { projectId } : {}), ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }, include: { project: { select: { id: true, name: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] }));
}));
app.get('/api/tasks/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const t = await db.task.findFirst({ where: { id, project: { ownerId: req.auth!.userId } }, include: { project: { select: { id: true, name: true } } } }); if (!t) return res.status(404).json({ error: 'Task not found' }); res.json(t); }));
app.post('/api/tasks', auth, wrap(async (req, res) => { const d = taskSchema.parse(req.body); const p = await db.project.findFirst({ where: { id: d.projectId, ownerId: req.auth!.userId } }); if (!p) return res.status(404).json({ error: 'Project not found' }); res.status(201).json(await db.task.create({ data: { ...d, dueDate: d.dueDate ? new Date(d.dueDate) : null } })); }));
app.put('/api/tasks/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const d = taskSchema.omit({ projectId: true }).partial().extend({ projectId: z.string().min(1).optional() }).parse(req.body); if (d.projectId && !await db.project.findFirst({ where: { id: d.projectId, ownerId: req.auth!.userId } })) return res.status(404).json({ error: 'Project not found' }); const result = await db.task.updateMany({ where: { id, project: { ownerId: req.auth!.userId } }, data: { ...d, ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}) } }); if (!result.count) return res.status(404).json({ error: 'Task not found' }); res.json(await db.task.findUnique({ where: { id } })); }));
app.delete('/api/tasks/:id', auth, wrap(async (req, res) => { const id = String(req.params.id); const result = await db.task.deleteMany({ where: { id, project: { ownerId: req.auth!.userId } } }); if (!result.count) return res.status(404).json({ error: 'Task not found' }); res.status(204).end(); }));
app.get('/api/dashboard', auth, wrap(async (req, res) => { const ownerId = req.auth!.userId; const [totalProjects, projectsInProgress, totalTasks, completedTasks, pendingTasks] = await Promise.all([db.project.count({ where: { ownerId } }), db.project.count({ where: { ownerId, status: 'IN_PROGRESS' } }), db.task.count({ where: { project: { ownerId } } }), db.task.count({ where: { project: { ownerId }, status: 'COMPLETED' } }), db.task.count({ where: { project: { ownerId }, status: 'PENDING' } })]); res.json({ totalProjects, projectsInProgress, totalTasks, completedTasks, pendingTasks }); }));
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => { if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.flatten() }); console.error(err); res.status(500).json({ error: 'Internal server error' }); });
app.listen(port, () => console.info(`Orbit API listening on http://localhost:${port}`));
