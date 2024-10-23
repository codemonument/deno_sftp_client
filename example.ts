import { SftpClient } from "./main.ts";

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
    uploaderName: "sftp_1",
    logMode: "unknown-and-error",
    // logMode: "verbose",
});

await sftpClient.ls();

const pwd = await sftpClient.pwd();
exampleLog("pwd", pwd);
try {
    await sftpClient.cd("www/maya.internett.de/playground");
} catch (error) {
    exampleLog("cd failed", error);
}

// await sftpClient.mkdir("./test/test2");

await sftpClient.close();

exampleLog("Sftp Client closed correctly");
