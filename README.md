# 🧵 CodeWeaver

> **Weave your codebase into AI-ready documentation**

An intelligent source code aggregation tool with AI-powered file selection, dependency analysis, and flexible compression options.

[![Python Version](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Flask](https://img.shields.io/badge/flask-3.0.0-black.svg)](https://flask.palletsprojects.com/)

## ✨ Key Features

- 🤖 **AI-Powered File Selection** - Find files using natural language queries
- 📊 **Dependency Analysis** - Visualize imports, detect circular dependencies
- 🗜️ **Smart Compression** - 4 modes: None, Semantic (67%), Lossless (75%), Hybrid
- 🔍 **Advanced Search** - Full-text search, bulk selection, extension filters
- 📄 **Markdown Export** - Generate AI-ready documentation with syntax highlighting

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/codeweaver.git
cd codeweaver
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure (create .env file)
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Run
python app.py
# Open http://localhost:5000
```

## 📖 Usage

### 1. Analyze Directory
```bash
Enter path → Click "Analyze" → View file tree
```

### 2. Select Files
**Manual**: Click checkboxes in tree  
**Bulk**: Enter filenames (one per line)  
**AI**: Natural language query
```
Example: "Find all files related to user authentication"
```

### 3. Generate Documentation
Choose compression mode → Click "Generate" → Download

## 🗜️ Compression Modes

| Mode | Size | Restoration | Best For |
|------|------|-------------|----------|
| None | 100% | ✅ Perfect | Small projects |
| Semantic | 33% | ❌ Structure only | AI analysis |
| Lossless | 25% | ✅ Perfect | Archival |
| Hybrid | 33% | ✅ With reference | Large projects |

## 🏗️ Tech Stack

**Backend**: Flask, Google Gemini AI, NetworkX  
**Frontend**: Vanilla JS, D3.js, Mermaid

## 📋 Requirements

- Python 3.8+
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## 🔧 Configuration

Create `.env` file:
```bash
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-1.5-flash  # or gemini-1.5-pro
GEMINI_TIMEOUT=60
```

## 🐛 Troubleshooting

**AI Selection Error?**
- Check API key is valid
- Use `gemini-1.5-flash` or `gemini-1.5-pro` (not `gemini-2.5-*`)

**Encoding Issues?**
- CodeWeaver auto-detects encoding via chardet

**Large Project Slow?**
- Use extension filters
- Enable hybrid compression

## 🤝 Contributing

```bash
# Fork → Create branch → Make changes → Submit PR
git checkout -b feature/AmazingFeature
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📝 License

MIT License - see [LICENSE](LICENSE)

## 🙏 Credits

Built with Flask, Google Gemini AI, D3.js, and ❤️!

---

⭐ **Star this repo if you find it useful!**

📧 Issues: [GitHub Issues](https://github.com/yourusername/codeweaver/issues)
