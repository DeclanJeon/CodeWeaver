#!/usr/bin/env python3

import os
import json
import re
from pathlib import Path
from typing import List, Set, Dict, Optional, Tuple, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from collections import defaultdict
import chardet
from flask import Flask, render_template, request, jsonify, send_file, session
from flask_cors import CORS
import secrets
import tempfile
import shutil
from functools import lru_cache
import threading
import time
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

from compressor import SemanticCompressor, LosslessCompressor, HybridCompressor
from dependency_analyzer import DependencyAnalyzer
from model_configuration import get_model_config

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
CORS(app, resources={r"/api/*": {"origins": "*"}})

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is not set")

genai.configure(api_key=GEMINI_API_KEY)

TEMP_DIR = Path(tempfile.gettempdir()) / "source_aggregator"
TEMP_DIR.mkdir(exist_ok=True)

ORIGINALS_DIR = TEMP_DIR / "originals"
ORIGINALS_DIR.mkdir(exist_ok=True)

SESSION_TIMEOUT = timedelta(hours=2)

# Initialize with enhanced model configuration

@dataclass
class FileInfo:
    path: str
    size: int
    extension: str
    relative_path: str
    selected: bool = False
    id: str = ""
    last_modified: float = 0
    
    def __post_init__(self):
        if not self.id:
            self.id = self.relative_path.replace('/', '_').replace('.', '_').replace('-', '_')

@dataclass
class DirectoryInfo:
    path: str
    name: str
    relative_path: str
    file_count: int = 0
    total_size: int = 0
    children: List[Dict] = field(default_factory=list)
    files: List[Dict] = field(default_factory=list)
    selected: bool = False
    expanded: bool = False
    id: str = ""
    
    def __post_init__(self):
        if not self.id:
            self.id = self.relative_path.replace('/', '_').replace('.', '_').replace('-', '_')

class WebSourceAggregator:
    
    DEFAULT_EXTENSIONS = {
        '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.h', '.hpp',
        '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r',
        '.html', '.css', '.scss', '.sass', '.less',
        '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config',
        '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
        '.dockerfile', '.dockerignore', '.gitignore', '.env', '.env.example',
        '.md', '.txt', '.rst', '.tex',
        '.vue', '.svelte', '.astro',
        '.prisma', '.graphql', '.proto'
    }
    
    DEFAULT_EXCLUDE_DIRS = {
        '.git', '.svn', '.hg', '.bzr',
        'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache',
        'venv', 'env', '.venv', '.env', 'virtualenv',
        'dist', 'build', 'out', 'target', 'bin', 'obj',
        '.idea', '.vscode', '.vs', '.sublime',
        'coverage', '.coverage', 'htmlcov',
        '.next', '.nuxt', '.cache', '.parcel-cache',
        'vendor', 'packages', 'bower_components'
    }
    
    # Method to check if a directory should be excluded
    def _should_exclude_dir(self, dir_name: str) -> bool:
        # Exclude directories starting with .
        if dir_name.startswith('.'):
            return True
        # Exclude directories in DEFAULT_EXCLUDE_DIRS
        if dir_name in self.DEFAULT_EXCLUDE_DIRS:
            return True
        return False
    
    def __init__(self, root_dir: str, max_file_size_mb: float = 10):
        self.root_dir = Path(root_dir).resolve()
        self._validate_root_dir()
        self.max_file_size = max_file_size_mb * 1024 * 1024
        self.all_files = {}
        self.all_directories = {}
        self.file_extensions = defaultdict(list)
        self.errors = []
        self.search_index = {}
    
    def _validate_root_dir(self):
        if not self.root_dir.exists():
            raise ValueError(f"Directory does not exist: {self.root_dir}")
        if not self.root_dir.is_dir():
            raise ValueError(f"Path is not a directory: {self.root_dir}")
        
        try:
            os.listdir(self.root_dir)
        except PermissionError:
            raise ValueError(f"Permission denied: {self.root_dir}")
    
    def analyze_directory_structure(self) -> Dict:
        
        def analyze_dir(dir_path: Path, parent_path: Path = None) -> Dict:
            relative_path = str(dir_path.relative_to(self.root_dir)) if dir_path != self.root_dir else "."
            
            dir_info = DirectoryInfo(
                path=str(dir_path),
                name=dir_path.name if dir_path != self.root_dir else self.root_dir.name,
                relative_path=relative_path
            )
            
            try:
                items = sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
                
                for item in items:
                    if item.is_dir() and not self._should_exclude_dir(item.name):
                        try:
                            child_data = analyze_dir(item, dir_path)
                            dir_info.children.append(child_data)
                            dir_info.file_count += child_data['file_count']
                            dir_info.total_size += child_data['total_size']
                        except PermissionError:
                            continue
                
                for item in items:
                    if item.is_file():
                        try:
                            # Get relative path to check for hidden directories in the path
                            relative_path = str(item.relative_to(self.root_dir))
                            path_parts = relative_path.split('/')
                            
                            # Check if file is hidden or in a hidden directory
                            is_hidden = item.name.startswith('.')
                            is_in_hidden_dir = any(part.startswith('.') for part in path_parts[:-1])
                            is_lock_file = 'lock' in item.name.lower() and item.name.endswith(('.yaml', '.yml', '.json'))
                            
                            # Skip hidden files, files in hidden directories, and lock files
                            if is_hidden or is_in_hidden_dir or is_lock_file:
                                continue
                                
                            file_stat = item.stat()
                            if file_stat.st_size <= self.max_file_size:
                                file_info = FileInfo(
                                    path=str(item),
                                    size=file_stat.st_size,
                                    extension=item.suffix.lower(),
                                    relative_path=relative_path,
                                    last_modified=file_stat.st_mtime
                                )
                                
                                file_dict = asdict(file_info)
                                dir_info.files.append(file_dict)
                                dir_info.file_count += 1
                                dir_info.total_size += file_stat.st_size
                                
                                self.all_files[file_info.id] = file_dict
                                self.file_extensions[file_info.extension].append(file_dict)
                                
                                self._index_file_for_search(file_info)
                        except Exception as e:
                            self.errors.append({'path': str(item), 'error': str(e)})
            
            except PermissionError as e:
                self.errors.append({'path': str(dir_path), 'error': f"Permission denied: {e}"})
            
            dir_dict = asdict(dir_info)
            self.all_directories[dir_info.id] = dir_dict
            return dir_dict
        
        root_structure = analyze_dir(self.root_dir)
        
        extension_stats = {}
        for ext, files in self.file_extensions.items():
            if ext:
                total_size = sum(f['size'] for f in files)
                extension_stats[ext] = {
                    'count': len(files),
                    'size': total_size,
                    'extension': ext
                }
        
        return {
            'tree': root_structure,
            'stats': {
                'total_files': len(self.all_files),
                'total_dirs': len(self.all_directories),
                'extensions': sorted(extension_stats.values(), key=lambda x: x['count'], reverse=True),
                'errors': len(self.errors)
            }
        }
    
    def _index_file_for_search(self, file_info: FileInfo):
        filename = Path(file_info.relative_path).name.lower()
        relative_path_lower = file_info.relative_path.lower()
        
        words = re.findall(r'\w+', filename)
        for word in words:
            if word not in self.search_index:
                self.search_index[word] = []
            self.search_index[word].append(file_info.id)
        
        if relative_path_lower not in self.search_index:
            self.search_index[relative_path_lower] = []
        self.search_index[relative_path_lower].append(file_info.id)
    
    def search_files(self, query: str) -> List[Dict]:
        if not query:
            return []
        
        query_lower = query.lower()
        matched_file_ids = set()
        
        for word in re.findall(r'\w+', query_lower):
            for index_key, file_ids in self.search_index.items():
                if word in index_key:
                    matched_file_ids.update(file_ids)
        
        for path_key, file_ids in self.search_index.items():
            if query_lower in path_key:
                matched_file_ids.update(file_ids)
        
        results = []
        for file_id in matched_file_ids:
            if file_id in self.all_files:
                file_info = self.all_files[file_id].copy()
                file_info['match_score'] = self._calculate_match_score(
                    file_info['relative_path'], query_lower
                )
                results.append(file_info)
        
        return sorted(results, key=lambda x: x['match_score'], reverse=True)
    
    def _calculate_match_score(self, path: str, query: str) -> float:
        path_lower = path.lower()
        filename = Path(path).name.lower()
        
        score = 0.0
        
        if query == filename:
            score += 100.0
        elif query in filename:
            score += 50.0
        elif query in path_lower:
            score += 25.0
        
        query_words = set(re.findall(r'\w+', query))
        path_words = set(re.findall(r'\w+', path_lower))
        
        if query_words:
            word_match_ratio = len(query_words & path_words) / len(query_words)
            score += word_match_ratio * 20.0
        
        if path_lower.startswith(query):
            score += 10.0
        
        return score
    
    def select_files_by_names(self, filenames: List[str]) -> Dict[str, List[str]]:
        selected = []
        not_found = []
        
        for filename in filenames:
            filename_lower = filename.lower()
            found = False
            
            for file_id, file_info in self.all_files.items():
                file_path = file_info['relative_path']
                if filename_lower in file_path.lower():
                    selected.append(file_id)
                    found = True
            
            if not found:
                not_found.append(filename)
        
        return {
            'selected': selected,
            'not_found': not_found
        }
    
    def generate_markdown(self, selected_files: List[str], compression_type: str = 'none') -> Tuple[str, Optional[Dict]]:
        lines = []
        
        lines.append("# Aggregated Source Code")
        lines.append(f"\n**Generated at:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"**Root Directory:** `{self.root_dir}`")
        lines.append(f"**Total Files:** {len(selected_files)}")
        lines.append(f"**Compression Type:** {compression_type}")
        
        lines.append("\n## Table of Contents\n")
        for i, file_id in enumerate(selected_files, 1):
            if file_id in self.all_files:
                file_info = self.all_files[file_id]
                lines.append(f"{i}. [{file_info['relative_path']}](#{file_id})")
        
        lines.append("\n---\n")
        
        for file_id in selected_files:
            if file_id in self.all_files:
                file_info = self.all_files[file_id]
                file_path = Path(file_info['path'])
                
                lines.append(f"\n## {file_info['relative_path']}\n")
                lines.append(f"**File Size:** {self._format_size(file_info['size'])}  ")
                lines.append(f"**Last Modified:** {datetime.fromtimestamp(file_info['last_modified']).strftime('%Y-%m-%d %H:%M:%S')}  ")
                lines.append("")
                
                try:
                    content, language = self._read_file_content(file_path)
                    lines.append(f"```{language}")
                    lines.append(content)
                    lines.append("```")
                except Exception as e:
                    lines.append(f"**Error reading file:** {e}")
                
                lines.append("\n---")
        
        markdown_content = '\n'.join(lines)
        
        if compression_type == 'none':
            return markdown_content, None
        elif compression_type == 'semantic':
            compressor = SemanticCompressor()
            compressed = compressor.compress_markdown(markdown_content)
            return json.dumps(compressed, ensure_ascii=False, indent=2), compressed
        elif compression_type == 'lossless':
            compressor = LosslessCompressor()
            compressed = compressor.compress_markdown(markdown_content)
            return json.dumps(compressed, ensure_ascii=False, indent=2), compressed
        elif compression_type == 'hybrid':
            compressor = HybridCompressor()
            compressed = compressor.compress_with_reference(markdown_content, ORIGINALS_DIR)
            return json.dumps(compressed, ensure_ascii=False, indent=2), compressed
        
        return markdown_content, None
    
    def _format_size(self, size_bytes: int) -> str:
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.2f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.2f} TB"
    
    @lru_cache(maxsize=128)
    def _detect_encoding(self, file_path: str) -> str:
        try:
            with open(file_path, 'rb') as f:
                raw_data = f.read(10000)
                result = chardet.detect(raw_data)
                encoding = result.get('encoding', 'utf-8')
                
                if not encoding or result.get('confidence', 0) < 0.7:
                    encoding = 'utf-8'
                
                return encoding
        except Exception:
            return 'utf-8'
    
    def _read_file_content(self, file_path: Path) -> tuple:
        language_map = {
            '.py': 'python', '.js': 'javascript', '.jsx': 'jsx',
            '.ts': 'typescript', '.tsx': 'tsx', '.java': 'java',
            '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
            '.cs': 'csharp', '.php': 'php', '.rb': 'ruby',
            '.go': 'go', '.rs': 'rust', '.swift': 'swift',
            '.kt': 'kotlin', '.scala': 'scala', '.r': 'r',
            '.html': 'html', '.css': 'css', '.scss': 'scss',
            '.json': 'json', '.xml': 'xml', '.yaml': 'yaml',
            '.yml': 'yaml', '.sql': 'sql', '.sh': 'bash',
            '.md': 'markdown', '.txt': 'text'
        }
        
        suffix = file_path.suffix.lower()
        language = language_map.get(suffix, 'text')
        
        if file_path.name == 'Dockerfile':
            language = 'dockerfile'
        elif file_path.name in ['Makefile', 'makefile']:
            language = 'makefile'
        
        encoding = self._detect_encoding(str(file_path))
        
        with open(file_path, 'r', encoding=encoding, errors='replace') as f:
            content = f.read()
        
        return content, language

class GeminiFileAnalyzer:
    def __init__(self, model_name: str = None):
        self.model_name = model_name or GEMINI_MODEL
        self.model = genai.GenerativeModel(self.model_name)
    
    def analyze_files_for_query(
        self,
        query: str,
        file_structure: Dict[str, Any]
    ) -> Dict[str, Any]:
        prompt = self._build_analysis_prompt(query, file_structure)
        
        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    top_p=0.95,
                    top_k=40,
                    max_output_tokens=8192,
                )
            )
            
            result = self._parse_gemini_response(response.text)
            
            return {
                'success': True,
                'selected_files': result.get('files', []),
                'reasoning': result.get('reasoning', ''),
                'confidence': result.get('confidence', 0.0)
            }
        except Exception as e:
            app.logger.error(f"Gemini API error: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _build_analysis_prompt(
        self,
        query: str,
        file_structure: Dict[str, Any]
    ) -> str:
        files_info = self._extract_file_info(file_structure)
        
        prompt = f"""You are an expert code analyzer. Analyze the following project structure and identify files related to the user's query.

**User Query (in Korean):** {query}

**Project Structure:**
{json.dumps(files_info, indent=2, ensure_ascii=False)}

**Task:**
1. Understand the user's intent from the Korean query
2. Analyze each file's path, name, and extension
3. Identify files that are likely related to the query
4. Provide reasoning for each selection

**Output Format (JSON):**
{{
    "files": [
        {{
            "file_id": "unique_file_identifier",
            "relative_path": "path/to/file.ext",
            "reason": "Why this file is relevant",
            "confidence": 0.95
        }}
    ],
    "reasoning": "Overall analysis explanation in Korean",
    "confidence": 0.85
}}

**Selection Criteria:**
- File names and paths that suggest relevant functionality
- Common patterns (e.g., "upload", "download", "transfer" for file transfer)
- File types that typically contain such logic (e.g., .py, .js for backend/frontend)
- Configuration files that might define related settings

Respond ONLY with valid JSON, no additional text."""

        return prompt
    
    def _extract_file_info(self, node: Dict, files_list: List = None) -> List[Dict]:
        if files_list is None:
            files_list = []
        
        if node.get('files'):
            for file in node['files']:
                files_list.append({
                    'id': file.get('id'),
                    'relative_path': file.get('relative_path'),
                    'extension': file.get('extension'),
                    'size': file.get('size')
                })
        
        if node.get('children'):
            for child in node['children']:
                self._extract_file_info(child, files_list)
        
        return files_list
    
    def _parse_gemini_response(self, response_text: str) -> Dict:
        try:
            cleaned_text = response_text.strip()
            
            if cleaned_text.startswith('```json'):
                cleaned_text = cleaned_text[7:]
            if cleaned_text.startswith('```'):
                cleaned_text = cleaned_text[3:]
            if cleaned_text.endswith('```'):
                cleaned_text = cleaned_text[:-3]
            
            cleaned_text = cleaned_text.strip()
            
            result = json.loads(cleaned_text)
            return result
        except json.JSONDecodeError as e:
            app.logger.error(f"JSON parsing error: {e}\nResponse: {response_text}")
            return {
                'files': [],
                'reasoning': 'Failed to parse AI response',
                'confidence': 0.0
            }

def cleanup_old_sessions():
    while True:
        try:
            now = datetime.now()
            for file in TEMP_DIR.glob("*"):
                if file.is_file():
                    file_age = now - datetime.fromtimestamp(file.stat().st_mtime)
                    if file_age > SESSION_TIMEOUT:
                        file.unlink()
            
            for file in ORIGINALS_DIR.glob("*"):
                if file.is_file():
                    file_age = now - datetime.fromtimestamp(file.stat().st_mtime)
                    if file_age > SESSION_TIMEOUT:
                        file.unlink()
        except Exception as e:
            app.logger.error(f"Cleanup error: {e}")
        
        time.sleep(3600)

cleanup_thread = threading.Thread(target=cleanup_old_sessions, daemon=True)
cleanup_thread.start()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/analyze', methods=['POST'])
def analyze_directory():
    data = request.json
    directory = data.get('directory', '.')
    
    directory = os.path.abspath(directory)
    
    if not os.path.exists(directory):
        return jsonify({'error': f'Directory not found: {directory}'}), 404
    
    try:
        aggregator = WebSourceAggregator(directory)
        result = aggregator.analyze_directory_structure()
        
        session['root_dir'] = directory
        session['analysis_id'] = secrets.token_hex(8)
        
        analysis_file = TEMP_DIR / f"{session['analysis_id']}_analysis.json"
        with open(analysis_file, 'w', encoding='utf-8') as f:
            json.dump({
                'root_dir': directory,
                'all_files': aggregator.all_files,
                'all_directories': aggregator.all_directories,
                'file_extensions': dict(aggregator.file_extensions),
                'search_index': aggregator.search_index
            }, f, ensure_ascii=False)
        
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Analysis error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/search', methods=['POST'])
def search_files():
    data = request.json
    query = data.get('query', '')
    
    if not query:
        return jsonify({'results': []})
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        aggregator = WebSourceAggregator(analysis_data['root_dir'])
        aggregator.all_files = analysis_data['all_files']
        aggregator.search_index = analysis_data['search_index']
        
        results = aggregator.search_files(query)
        
        return jsonify({'results': results[:50]})
    except Exception as e:
        app.logger.error(f"Search error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/select-by-names', methods=['POST'])
def select_by_names():
    data = request.json
    filenames = data.get('filenames', [])
    
    if not filenames:
        return jsonify({'error': 'No filenames provided'}), 400
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        aggregator = WebSourceAggregator(analysis_data['root_dir'])
        aggregator.all_files = analysis_data['all_files']
        
        result = aggregator.select_files_by_names(filenames)
        
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Select by names error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/generate', methods=['POST'])
def generate_markdown():
    data = request.json
    selected_files = data.get('files', [])
    compression_type = data.get('compression_type', 'none')
    
    if not selected_files:
        return jsonify({'error': 'No files selected'}), 400
    
    if compression_type not in ['none', 'semantic', 'lossless', 'hybrid']:
        return jsonify({'error': 'Invalid compression type'}), 400
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        aggregator = WebSourceAggregator(analysis_data['root_dir'])
        aggregator.all_files = analysis_data['all_files']
        aggregator.all_directories = analysis_data['all_directories']
        
        markdown_content, compression_info = aggregator.generate_markdown(
            selected_files,
            compression_type
        )
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if compression_type == 'none':
            extension = 'md'
        else:
            extension = 'json'
        
        output_file = TEMP_DIR / f"source_code_{compression_type}_{timestamp}.{extension}"
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(markdown_content)
        
        response_data = {
            'success': True,
            'filename': output_file.name,
            'size': len(markdown_content),
            'file_count': len(selected_files),
            'compression_type': compression_type
        }
        
        if compression_info and 'metadata' in compression_info:
            response_data['compression_info'] = compression_info['metadata']
        
        return jsonify(response_data)
    except Exception as e:
        app.logger.error(f"Generate error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/<filename>')
def download_file(filename):
    file_path = TEMP_DIR / filename
    
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    if filename.endswith('.json'):
        mimetype = 'application/json'
    else:
        mimetype = 'text/markdown'
    
    return send_file(
        file_path,
        as_attachment=True,
        download_name=filename,
        mimetype=mimetype
    )

@app.route('/api/preview', methods=['POST'])
def preview_file():
    data = request.json
    file_path = data.get('path')
    
    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404
    
    try:
        file_path = Path(file_path)
        
        if file_path.stat().st_size > 1024 * 1024:
            return jsonify({'error': 'File too large for preview'}), 413
        
        with open(file_path, 'rb') as f:
            raw_data = f.read(1000)
            result = chardet.detect(raw_data)
            encoding = result.get('encoding', 'utf-8')
        
        with open(file_path, 'r', encoding=encoding, errors='replace') as f:
            content = f.read(5000)
            if len(content) == 5000:
                content += "\n\n... (truncated)"
        
        return jsonify({
            'content': content,
            'encoding': encoding
        })
    except Exception as e:
        app.logger.error(f"Preview error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/decompress', methods=['POST'])
def decompress_file():
    data = request.json
    compressed_data = data.get('data')
    
    if not compressed_data:
        return jsonify({'error': 'No compressed data provided'}), 400
    
    try:
        compression_type = compressed_data.get('metadata', {}).get('compression_type')
        
        if compression_type == 'gzip_lossless':
            compressor = LosslessCompressor()
            original_content = compressor.decompress_markdown(compressed_data)
            
            return jsonify({
                'success': True,
                'content': original_content,
                'size': len(original_content)
            })
        elif compression_type == 'hybrid':
            compressor = HybridCompressor()
            original_content = compressor.get_original_content(
                compressed_data['original_reference'],
                compressed_data
            )
            
            if not original_content:
                return jsonify({'error': 'Original file not found'}), 404
            
            return jsonify({
                'success': True,
                'content': original_content,
                'size': len(original_content)
            })
        else:
            return jsonify({'error': 'Cannot decompress semantic compression'}), 400
    except Exception as e:
        app.logger.error(f"Decompress error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai-select', methods=['POST'])
def ai_select_files():
    data = request.json
    query = data.get('query', '')
    
    if not query:
        return jsonify({'error': 'Query is required'}), 400
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found. Please analyze directory first.'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        tree_structure = {
            'files': list(analysis_data['all_files'].values()),
            'children': []
        }
        
        analyzer = GeminiFileAnalyzer()
        result = analyzer.analyze_files_for_query(query, tree_structure)
        
        if not result['success']:
            return jsonify({'error': result.get('error', 'AI analysis failed')}), 500
        
        selected_file_ids = [f['file_id'] for f in result['selected_files']]
        
        valid_selections = []
        for file_id in selected_file_ids:
            if file_id in analysis_data['all_files']:
                valid_selections.append(file_id)
        
        return jsonify({
            'success': True,
            'selected_files': valid_selections,
            'file_details': result['selected_files'],
            'reasoning': result['reasoning'],
            'confidence': result['confidence'],
            'total_selected': len(valid_selections)
        })
    
    except Exception as e:
        app.logger.error(f"AI selection error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/analyze-dependencies', methods=['POST'])
def analyze_dependencies():
    data = request.json
    selected_files = data.get('files', [])
    
    if not selected_files:
        return jsonify({'error': 'No files selected'}), 400
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        analyzer = DependencyAnalyzer(
            analysis_data['all_files'],
            analysis_data['root_dir']
        )
        
        result = analyzer.analyze_dependencies(selected_files)
        
        dep_file = TEMP_DIR / f"{analysis_id}_dependencies.json"
        with open(dep_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        
        return jsonify({
            'success': True,
            'analysis': result
        })
    
    except Exception as e:
        app.logger.error(f"Dependency analysis error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/add-missing-dependencies', methods=['POST'])
def add_missing_dependencies():
    data = request.json
    missing_file_ids = data.get('file_ids', [])
    
    if not missing_file_ids:
        return jsonify({'error': 'No file IDs provided'}), 400
    
    try:
        analysis_id = session.get('analysis_id')
        if not analysis_id:
            return jsonify({'error': 'No analysis found'}), 400
        
        analysis_file = TEMP_DIR / f"{analysis_id}_analysis.json"
        if not analysis_file.exists():
            return jsonify({'error': 'Analysis data not found'}), 404
        
        with open(analysis_file, 'r', encoding='utf-8') as f:
            analysis_data = json.load(f)
        
        valid_files = []
        for file_id in missing_file_ids:
            if file_id in analysis_data['all_files']:
                valid_files.append(file_id)
        
        return jsonify({
            'success': True,
            'added_files': valid_files,
            'count': len(valid_files)
        })
    
    except Exception as e:
        app.logger.error(f"Add dependencies error: {e}")
        return jsonify({'error': str(e)}), 500




if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)