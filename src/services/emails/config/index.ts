import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
// import { CreateEmailOptions } from 'resend';

import nodemailer, { SendMailOptions } from 'nodemailer';

export const emailSenderConfig = async (
  options: SendMailOptions,
): Promise<boolean> => {
  const transport = nodemailer.createTransport({
    host: 'smtp.zeptomail.com',
    port: 465,
    auth: {
      user: 'emailApiKey',
      pass: process.env.ZOHO_CPASS_PASSWORD,
    },
  });

  try {
    await transport.sendMail(options);

    return true;
  } catch (error) {
    console.log({ error });
    return false;
  }
};

export const emailTemplateBuilder = (
  templateFileName: string,
  email: string,
  subject: string,
  pageHeading: string,
  data: object,
) => {
  const templatesPath = path.join(__dirname, '../../../../views/templates');

  // 1. Compile the specific email body (e.g., welcome-user.hbs)
  const bodySource = fs.readFileSync(
    path.join(templatesPath, templateFileName),
    'utf-8',
  );
  const bodyGenerator = handlebars.compile(bodySource);
  const bodyHtml = bodyGenerator(data);

  // 2. Compile the Master Layout and inject the body HTML into it
  const layoutSource = fs.readFileSync(
    path.join(templatesPath, 'layout.hbs'),
    'utf-8',
  );
  const layoutGenerator = handlebars.compile(layoutSource);

  // Pass the data PLUS the newly compiled body
  const html = layoutGenerator({
    ...data,
    pageHeading,
    body: bodyHtml,
    brandUrl: 'https://www.elitewholesalers.com.au',
  });

  return {
    from: 'Elite Wholesalers <info@elitewholesalers.com.au>',
    to: email,
    subject,
    html,
  };
};
