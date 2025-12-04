// src/lib/email/transport.ts
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

if (!host || !port || !user || !pass) {
  // You can soften this if you want lazy init
  throw new Error("[email] SMTP env vars are missing");
}

export const brevoTransport = nodemailer.createTransport({
  host,
  port: Number(port),
  secure: false, // STARTTLS on 587
  auth: { user, pass },
});
