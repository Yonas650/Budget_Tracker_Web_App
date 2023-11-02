import './config.mjs';
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url';
import session from 'express-session'; 
const app = express();
import './db.mjs';
import mongoose from 'mongoose';
// Middleware to parse request bodies
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.listen(process.env.PORT || 3000);
