import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url';

const app = express();
// Middleware to parse request bodies
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.listen(process.env.PORT || 3000);
