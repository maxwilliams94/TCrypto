import express, { Express, Request, Response } from 'express';
import { currencyRateRepository } from '../index';

export const currencyRatesRouter = express.Router();

// Get all currency rates
currencyRatesRouter.get('/', async (req: Request, res: Response) => {
    try {
        const rates = await currencyRateRepository.getAll();
        res.json({
            count: rates.length,
            rates: rates
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get rates for a specific asset/quote pair
currencyRatesRouter.get('/:asset/:quote', async (req: Request, res: Response) => {
    try {
        const { asset, quote } = req.params;
        const rates = await currencyRateRepository.getRatesByAsset(asset.toUpperCase(), quote.toUpperCase());
        res.json({
            asset: asset.toUpperCase(),
            quote: quote.toUpperCase(),
            count: rates.length,
            rates: rates
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get rates for a specific date
currencyRatesRouter.get('/date/:date', async (req: Request, res: Response) => {
    try {
        const date = new Date(req.params.date);
        if (isNaN(date.getTime())) {
            res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
            return;
        }

        const rates = await currencyRateRepository.getRatesByDate(date);
        res.json({
            date: date.toISOString().split('T')[0],
            count: rates.length,
            rates: rates
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Clear all currency rates (useful for testing)
currencyRatesRouter.delete('/', async (req: Request, res: Response) => {
    try {
        await currencyRateRepository.clear();
        res.json({ message: 'All currency rates cleared' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});