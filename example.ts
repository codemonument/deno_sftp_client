import { SftpClient } from "./main.ts";

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "sftp_1",
});

await sftpClient.ls();

await sftpClient.close();
