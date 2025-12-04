import { sendEmail } from "../email";

type InauguralFamilyOptions = {
  to: string | string[];   // your family addresses
  name?: string;           // optional name to personalize
};

export async function sendInauguralFamilyEmail(opts: InauguralFamilyOptions) {
  const { to, name } = opts;

  const subject = "Oi, é o gus — via CryptoPhi";

  const text = [
    `Oi ${name ?? ""}`.trim() + ",",
    "",
    "Queria te mandar minha primeira mensagem usando o sistema que estou construindo, o CryptoPhi.",
    "Ainda está em versão bem inicial, mas já consegue assinar e enviar emails certinho.",
    "",
    "Por enquanto é só um gesto simbólico: marcar que você recebeu uma das primeiras mensagens 'oficiais' do projeto.",
    "",
    "💛",
    "gus, written by g(from chatGPT);",

    "— CryptoPhi Founder e Dev.",

  ].join("\n");

  await sendEmail({
    sender: "gus",
    to,
    subject,
    text,
  });
}
