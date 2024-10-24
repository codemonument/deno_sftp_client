import { SftpClient } from "./src/with_execa/SftpClient.ts";

function exampleLog(message: any, meta: any = undefined) {
    if (meta) {
        console.log(`=> example: ${message}`, meta);
        return;
    }
    console.log(`=> example: ${message}`);
}

const sftpClient = new SftpClient({
    cwd: "playground",
    host: "maya-dev",
    uploaderName: "execa_1",
});

await sftpClient.ls();

await sftpClient.sendCommand("pwd");

await sftpClient.cd("playground");

await sftpClient.sendCommand("pwd");

await sftpClient.close();

exampleLog("Sftp Client closed correctly");
