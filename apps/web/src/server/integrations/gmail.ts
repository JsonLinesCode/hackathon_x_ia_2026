import "server-only";
import { z } from "zod";
import { escapeHtml } from "@repo/core";
import { googleRequest } from "./google-auth";
import type { Audit } from "./errors";

export const MailSchema = z.object({
  to: z.string().email(), subject: z.string().min(1).max(500).refine((v) => !/[\r\n]/.test(v), "Mail subject must be a single line"),
  body: z.string().max(40000), links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  messageId: z.string().regex(/^<[a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+>$/),
  threadId: z.string().optional(), inReplyTo: z.string().regex(/^<[^<>\r\n]+>$/).optional(),
});
export type Mail = z.infer<typeof MailSchema>;
const header = (value: string) => { if (/[\r\n]/.test(value)) throw new Error("Invalid mail header"); return value; };
const base64Lines = (value: string) => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
export function encodeMail(input: Mail, sender: string) {
  const mail = MailSchema.parse(input);
  const boundary = "tm_" + mail.messageId.replace(/[^a-zA-Z0-9]/g, "");
  const html = "<div style=\"font-family:Arial,sans-serif;max-width:620px;line-height:1.6\">" +
    mail.body.split("\n").map((line) => "<p>" + escapeHtml(line) + "</p>").join("") +
    mail.links.map((link) => {
      if (!["https:", "http:"].includes(new URL(link.url).protocol)) throw new Error("Unsupported mail link");
      return '<p><a style="background:#6256ef;color:white;padding:10px 16px;text-decoration:none" href="' + escapeHtml(link.url) + '">' + escapeHtml(link.label) + "</a></p>";
    }).join("") + "</div>";
  const plain = mail.body + "\n\n" + mail.links.map((link) => link.label + ": " + link.url).join("\n");
  return Buffer.from([
    "From: " + header(z.string().email().parse(sender)), "To: " + header(mail.to),
    "Subject: =?UTF-8?B?" + Buffer.from(header(mail.subject)).toString("base64") + "?=",
    "Message-ID: " + mail.messageId, "MIME-Version: 1.0",
    ...(mail.inReplyTo ? ["In-Reply-To: " + header(mail.inReplyTo), "References: " + header(mail.inReplyTo)] : []),
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', "",
    "--" + boundary, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(plain),
    "--" + boundary, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Lines(html),
    "--" + boundary + "--", "",
  ].join("\r\n")).toString("base64url");
}
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
export type GmailMessage = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; snippet?: string;
  payload?: Part & { headers?: { name?: string; value?: string }[] } };
export function mailHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}
export function mailText(message: GmailMessage) {
  const texts: string[] = [];
  const visit = (part: Part) => {
    if (part.mimeType === "text/plain" && part.body?.data) texts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    part.parts?.forEach(visit);
  };
  if (message.payload) visit(message.payload);
  return (texts.join("\n") || message.snippet || "").slice(0, 16000);
}
export function senderAddress(message: GmailMessage) {
  const from = mailHeader(message, "from").trim();
  return (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase();
}
export async function sendMail(owner: string, sender: string, mail: Mail, audit: Audit) {
  const value = await googleRequest(owner, "/gmail/v1/users/me/messages/send", audit, { label: "send email", method: "POST",
    body: { raw: encodeMail(mail, sender), ...(mail.threadId ? { threadId: mail.threadId } : {}) } });
  return z.object({ id: z.string(), threadId: z.string() }).parse(value);
}
export async function listMessages(owner: string, query: string, audit: Audit, pageToken?: string) {
  const params = new URLSearchParams({ q: query, maxResults: "25", ...(pageToken ? { pageToken } : {}) });
  return googleRequest<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(owner,
    "/gmail/v1/users/me/messages?" + params, audit, { label: "list emails" });
}
export function getMessage(owner: string, id: string, audit: Audit) {
  return googleRequest<GmailMessage>(owner, "/gmail/v1/users/me/messages/" + encodeURIComponent(id) + "?format=full", audit, { label: "read email" });
}
export async function findSent(owner: string, messageId: string, audit: Audit) {
  const listed = await listMessages(owner, "in:sent rfc822msgid:" + messageId.replace(/[<>]/g, ""), audit);
  const id = listed.messages?.[0]?.id;
  return id ? getMessage(owner, id, audit) : null;
}
