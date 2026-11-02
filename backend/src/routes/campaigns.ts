import { Router } from 'express';
import { CampaignInput, scheduleCampaign } from '../services/campaigns';

export const campaignsRouter = Router();

campaignsRouter.post('/', async (req, res) => {
  const input = CampaignInput.parse(req.body);
  res.status(201).json(await scheduleCampaign(req.userId!, input));
});
