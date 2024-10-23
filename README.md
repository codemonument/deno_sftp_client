# sftp-client

---

# Changelog

## 0.5.0 - WIP

- rewrite sftp output matching to use ts-pattern
  => for more explicit matching than
  splitting the output line on the space character and switching over the first element
  which for some outputs may not be enought to dissambiguate or is not convenient

## 0.4.0 - 2024-10-22

- add SftpClient.help() command
- add SftpClient.pwd() command which returns the pwd to the caller
- upgrade @codemonument/puppet-process to 1.0.1 (removes annoying debug log)

## 0.3.0 - 2024-10-22

- switch from execa to jsr:@codemonument/puppet-process for easier subprocess handling

## 0.2.0 - 2024-10-18

- improve docs for jsr

## 0.1.0 - 2024-10-18

**Initial release**

- extracted from another project and adapted to deno authoring and publishing on jsr
- Intention: make it comaptible with bun also by not using deno specifics, but only nodejs basics and npm dependencies, as well as deno @std dependencies, which are also available in nodejs
  (not tested yet)
