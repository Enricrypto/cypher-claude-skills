const fs = require("fs")
const path = require("path")

const projectRoot = process.env.INIT_CWD || process.cwd()
const skillsDest = path.join(projectRoot, ".claude", "skills")
const skillsSrc = path.join(__dirname, "skills")
const claudeMd = path.join(projectRoot, "CLAUDE.md")

// Recursively copy a directory
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

// Create .claude/skills/ in the target project
fs.mkdirSync(skillsDest, { recursive: true })

// Install each skill (file or directory)
const skills = fs.readdirSync(skillsSrc, { withFileTypes: true })
const skillNames = []

for (const entry of skills) {
  const srcPath = path.join(skillsSrc, entry.name)
  const destPath = path.join(skillsDest, entry.name)

  if (entry.isDirectory()) {
    copyDir(srcPath, destPath)
    console.log(`✓ Installed skill (directory): ${entry.name}`)
  } else {
    fs.copyFileSync(srcPath, destPath)
    console.log(`✓ Installed skill (file): ${entry.name}`)
  }

  skillNames.push(entry.name.replace(".md", ""))
}

// Scaffold CLAUDE.md if it doesn't exist
if (!fs.existsSync(claudeMd)) {
  const skillList = skillNames.map((s) => `- ${s}`).join("\n")
  fs.writeFileSync(
    claudeMd,
    `# Claude Instructions

## Skill Activation Policy
Never activate skills automatically. Always ask: "Would you like me to activate the [skill-name] skill now?" and wait for explicit approval before proceeding.

## Available Skills
${skillList}
`
  )
  console.log("✓ Created CLAUDE.md")
} else {
  console.log("⚠ CLAUDE.md already exists, skipping.")
}

console.log("\n✅ cypher-claude-skills installed successfully.")
