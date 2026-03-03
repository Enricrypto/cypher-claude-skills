const fs = require("fs")
const path = require("path")

const projectRoot = process.env.INIT_CWD || process.cwd()
const skillsDest = path.join(projectRoot, ".claude", "skills")
const skillsSrc = path.join(__dirname, "skills")
const claudeMd = path.join(projectRoot, "CLAUDE.md")

// Create .claude/skills/ in the target project
fs.mkdirSync(skillsDest, { recursive: true })

// Copy all skill files
const skills = fs.readdirSync(skillsSrc)
for (const file of skills) {
  fs.copyFileSync(path.join(skillsSrc, file), path.join(skillsDest, file))
  console.log(`✓ Installed skill: ${file}`)
}

// Scaffold CLAUDE.md if it doesn't exist
if (!fs.existsSync(claudeMd)) {
  const skillList = skills.map((f) => `- ${f.replace(".md", "")}`).join("\n")

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
