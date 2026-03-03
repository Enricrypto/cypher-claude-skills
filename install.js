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
  const skillList = skills
    .map((s) => `- ${s.name.replace(".md", "")}`)
    .join("\n")

  fs.writeFileSync(
    claudeMd,
    `# Claude Instructions

## Approval Policy — NON-NEGOTIABLE

Before ANY of the following, you MUST stop and ask for explicit approval:
- Editing, creating, or deleting any file
- Running any shell command
- Installing any package
- Making any git commit or push
- Calling any external API or service
- Activating any skill

Never assume approval based on context. Always ask explicitly.
If I say "go ahead" or "yes" to a plan, that is NOT approval to start executing.
Ask again before each individual action.

## Skill Activation Policy

Never activate skills automatically. Always ask:
"Would you like me to activate the [skill-name] skill now?"
Only proceed after explicit approval.

## Available Skills
${skillList}
`
  )
  console.log("✓ Created CLAUDE.md with approval policy")
} else {
  // CLAUDE.md exists — check if approval policy is already there
  const existing = fs.readFileSync(claudeMd, "utf8")
  if (!existing.includes("Approval Policy")) {
    fs.appendFileSync(
      claudeMd,
      `

## Approval Policy — NON-NEGOTIABLE

Before ANY of the following, you MUST stop and ask for explicit approval:
- Editing, creating, or deleting any file
- Running any shell command
- Installing any package
- Making any git commit or push
- Calling any external API or service
- Activating any skill

Never assume approval based on context. Always ask explicitly.
If I say "go ahead" or "yes" to a plan, that is NOT approval to start executing.
Ask again before each individual action.
`
    )
    console.log("✓ Appended approval policy to existing CLAUDE.md")
  } else {
    console.log("⚠ CLAUDE.md already has approval policy, skipping.")
  }
}

console.log("\n✅ cypher-claude-skills installed successfully.")
