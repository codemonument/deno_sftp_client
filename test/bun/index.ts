import { SftpClient } from "@codemonument/sftp-client";

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "sftp_1",
});

await sftpClient.ls();

await sftpClient.close();
