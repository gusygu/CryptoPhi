import "dotenv/config";
import { sendInauguralFamilyEmail } from "@/lib/notifications/templates/inauguralFamily";

async function main() {
  await sendInauguralFamilyEmail({
    to: [
      "biabmap@gmail.com", "gmapereira1994@gmail.com"
    ],
    name: "pessoal", // or leave undefined
  });

  console.log("Inaugural family email sent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
