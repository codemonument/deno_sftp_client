import { SftpClient } from "./main.ts";

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "sftp_1",
});

await sftpClient.ls();

const pwd = await sftpClient.pwd();
console.log(pwd);

// await sftpClient.mkdir("./test/test2");

await sftpClient.close();
