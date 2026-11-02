import { Router } from 'express';
import { addSender, listOrProvisionSenders } from '../services/senders';

export const sendersRouter = Router();

sendersRouter.get('/', async (req, res) => {
  res.json({ items: await listOrProvisionSenders(req.userId!) });
});

sendersRouter.post('/', async (req, res) => {
  res.status(201).json(await addSender(req.userId!));
});
