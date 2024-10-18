import { SftpClient } from "./main.ts";

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "Deno SftpClient Test",
});
