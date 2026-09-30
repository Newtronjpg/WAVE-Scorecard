import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

// Everything else about the mail path is tested without nodemailer: the
// wording is pure string building, and resolveMailConfig only reads env. That
// left the one thing a dependency upgrade can actually break -- the library's
// own API -- covered by nothing at all, which is how nodemailer went from 9 to
// 10 with 531 green tests saying nothing about it either way.
//
// These call the REAL library, not a mock. A mock would assert that our calls
// match our own expectations, which stays green through any upstream rename.
// No network: createTransport builds an object, and nothing here sends.

describe("the nodemailer API lib/email.ts depends on", () => {
  it("still builds a transport from the Gmail options deliver() passes", () => {
    // Byte for byte the options in lib/email.ts:119. A major version that
    // renamed or restructured this is the failure worth catching.
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "someone@example.test", pass: "app-password" },
    });

    expect(transporter).toBeTruthy();
    expect(typeof transporter.sendMail).toBe("function");
  });

  it("still accepts the message shape deliver() sends", () => {
    // sendMail is never called here -- that would open a socket to Gmail.
    // What is pinned is the options type of the INSTALLED version: a breaking
    // change to the message shape fails this at typecheck, which is the only
    // place it can be caught without sending real mail.
    type Message = Parameters<
      ReturnType<typeof nodemailer.createTransport>["sendMail"]
    >[0];

    const message = {
      from: "WAVE Scorecard <someone@example.test>",
      to: ["staff@example.test"],
      subject: "Subject line",
      text: "Body",
    } satisfies Message;

    expect(message.to).toHaveLength(1);
  });
});
