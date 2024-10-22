# sftp-client

---

# Changelog

## 0.3.0 - 2024-10-22

- switch from execa to jsr:@codemonument/puppet-process for easier subprocess handling

## 0.2.0 - 2024-10-18

- improve docs for jsr

## 0.1.0 - 2024-10-18

**Initial release**

- extracted from another project and adapted to deno authoring and publishing on jsr
- Intention: make it comaptible with bun also by not using deno specifics, but only nodejs basics and npm dependencies, as well as deno @std dependencies, which are also available in nodejs
  (not tested yet)
