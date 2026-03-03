#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

const command = process.argv[2]
const skillName = process.argv[3]

const skillsSrc = path.join(__dirname, "skills")
const projectRoot = process.env.INIT_CWD || process.cwd()
const skillsDest = path.join(projectRoot, ".claude", "skills")
const claudeMd = path.join(projectRoot, "CLAUDE.md")

const commands = {
  // Install all skills into current project
  init() {
    require("./install.js")
  },

  // List all available skills
  list() {
    const skills = fs.readdirSync(skillsSrc)
    console.log("\nAvailable skills:")
    skills.forEach((f) => console.log(`  - ${f.replace(".md", "")}`))
  },

  // Add a new skill to the repo
  add() {
    if (!skillName) {
      console.error("Usage: cypher-skills add <skill-name>")
      process.exit(1)
    }
    const skillFile = path.join(skillsSrc, `${skillName}.md`)
    if (fs.existsSync(skillFile)) {
      console.error(`✗ Skill "${skillName}" already exists.`)
      process.exit(1)
    }
    fs.writeFileSync(
      skillFile,
      `# ${skillName}\n\n<!-- Add your skill instructions here -->\n`
    )
    console.log(
      `✓ Created skills/${skillName}.md — open it and add your instructions.`
    )
  },

  // Sync skills into current project (re-runs install)
  sync() {
    function copyDir(src, dest) {
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)
        if (entry.isDirectory()) {
          copyDir(srcPath, destPath)
        } else {
          fs.copyFileSync(srcPath, destPath)
        }
      }
    }

    fs.mkdirSync(skillsDest, { recursive: true })
    const skills = fs.readdirSync(skillsSrc, { withFileTypes: true })
    for (const entry of skills) {
      const srcPath = path.join(skillsSrc, entry.name)
      const destPath = path.join(skillsDest, entry.name)
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
      console.log(`✓ Synced: ${entry.name}`)
    }
    console.log("\n✅ Skills synced successfully.")
  }
}

if (!command || !commands[command]) {
  console.log(`
cypher-skills — Claude Code skill manager

Commands:
  init    Install all skills into current project
  list    List all available skills
  add     Create a new skill (cypher-skills add <skill-name>)
  sync    Re-sync skills into current project
  `)
  process.exit(0)
}

commands[command]()
