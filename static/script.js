let treeData = null;
let allFiles = {};
let selectedFiles = new Set();
let selectedDirectories = new Set();
let statistics = null;
let searchResults = [];
let searchActive = false;
let currentCompressionType = 'none';
let lastGeneratedData = null;

let analyzeBtn, generateBtn, selectAllBtn, deselectAllBtn, expandAllBtn, collapseAllBtn;
let extensionFilter, searchInput, searchBtn, clearSearchBtn, bulkSelectInput, bulkSelectBtn;
let aiSelectBtn, aiQueryInput, analyzeDepsBtn;

function initializeEventListeners() {
    analyzeBtn = document.getElementById('analyzeBtn');
    generateBtn = document.getElementById('generateBtn');
    selectAllBtn = document.getElementById('selectAllBtn');
    deselectAllBtn = document.getElementById('deselectAllBtn');
    expandAllBtn = document.getElementById('expandAllBtn');
    collapseAllBtn = document.getElementById('collapseAllBtn');
    extensionFilter = document.getElementById('extensionFilter');
    searchInput = document.getElementById('searchInput');
    searchBtn = document.getElementById('searchBtn');
    clearSearchBtn = document.getElementById('clearSearchBtn');
    bulkSelectInput = document.getElementById('bulkSelectInput');
    bulkSelectBtn = document.getElementById('bulkSelectBtn');
    aiSelectBtn = document.getElementById('aiSelectBtn');
    aiQueryInput = document.getElementById('aiQueryInput');
    analyzeDepsBtn = document.getElementById('analyzeDepsBtn');

    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeDirectory);
    if (generateBtn) generateBtn.addEventListener('click', generateMarkdown);
    if (selectAllBtn) selectAllBtn.addEventListener('click', () => selectAll(true));
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => selectAll(false));
    if (expandAllBtn) expandAllBtn.addEventListener('click', () => expandAll(true));
    if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => expandAll(false));
    if (extensionFilter) extensionFilter.addEventListener('change', filterByExtension);
    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);
    if (bulkSelectBtn) bulkSelectBtn.addEventListener('click', bulkSelectFiles);
    if (aiSelectBtn) aiSelectBtn.addEventListener('click', performAISelection);
    if (analyzeDepsBtn) analyzeDepsBtn.addEventListener('click', analyzeDependencies);

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        searchInput.addEventListener('input', debounce(performSearch, 300));
    }

    if (bulkSelectInput) {
        bulkSelectInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                bulkSelectFiles();
            }
        });
    }

    if (aiQueryInput) {
        aiQueryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                performAISelection();
            }
        });
    }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEventListeners);
} else {
    initializeEventListeners();
}

async function analyzeDirectory() {
    const directoryPath = document.getElementById('directoryPath').value.trim();
    
    if (!directoryPath) {
        showStatus('analyzeStatus', 'error', 'Please enter a directory path.');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ directory: directoryPath })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Analysis failed');
        }
        
        const data = await response.json();
        treeData = data.tree;
        statistics = data.stats;
        
        buildFileIndex(treeData);
        
        renderTree();
        updateStatistics();
        populateExtensionFilter();
        
        document.getElementById('step2').style.display = 'block';
        document.getElementById('step3').style.display = 'block';
        
        showStatus('analyzeStatus', 'success', `✅ Analysis complete! Found ${statistics.total_files} files and ${statistics.total_dirs} directories.`);
    } catch (error) {
        showStatus('analyzeStatus', 'error', `❌ Error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function buildFileIndex(node) {
    if (!node.id) {
        node.id = node.relative_path.replace(/\//g, '_').replace(/\./g, '_');
    }
    
    if (node.files) {
        node.files.forEach(file => {
            if (!file.id) {
                file.id = file.relative_path.replace(/\//g, '_').replace(/\./g, '_');
            }
            allFiles[file.id] = file;
        });
    }
    
    if (node.children) {
        node.children.forEach(child => buildFileIndex(child));
    }
}

async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        clearSearch();
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Search failed');
        }
        
        const data = await response.json();
        searchResults = data.results;
        searchActive = true;
        
        highlightSearchResults();
        renderTree();
        
        document.getElementById('searchResultCount').textContent = 
            `${searchResults.length} results found.`;
        document.getElementById('searchResultsSection').style.display = 'block';
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `Search error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function highlightSearchResults() {
    const resultIds = new Set(searchResults.map(r => r.id));
    
    Object.values(allFiles).forEach(file => {
        file.searchMatch = resultIds.has(file.id);
    });
    
    expandPathsToResults(treeData, resultIds);
}

function expandPathsToResults(node, resultIds) {
    let hasMatch = false;
    
    if (node.files) {
        for (const file of node.files) {
            if (resultIds.has(file.id)) {
                hasMatch = true;
                break;
            }
        }
    }
    
    if (node.children) {
        for (const child of node.children) {
            if (expandPathsToResults(child, resultIds)) {
                hasMatch = true;
            }
        }
    }
    
    if (hasMatch) {
        node.expanded = true;
    }
    
    return hasMatch;
}

function clearSearch() {
    searchInput.value = '';
    searchResults = [];
    searchActive = false;
    
    Object.values(allFiles).forEach(file => {
        file.searchMatch = false;
    });
    
    document.getElementById('searchResultsSection').style.display = 'none';
    renderTree();
}

async function bulkSelectFiles() {
    const input = bulkSelectInput.value.trim();
    
    if (!input) {
        showStatus('analyzeStatus', 'error', 'Please enter a filename.');
        return;
    }
    
    const filenames = input.split(/[\n,]/).map(f => f.trim()).filter(f => f);
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/select-by-names', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filenames })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Selection failed');
        }
        
        const data = await response.json();
        
        data.selected.forEach(fileId => {
            if (allFiles[fileId]) {
                allFiles[fileId].selected = true;
                // Add file ID to selectedFiles Set
                selectedFiles.add(fileId);
            }
        });
        
        updateParentDirectories(treeData);
        renderTree();
        updateStatistics();
        
        let message = `✅ ${data.selected.length} files selected`;
        if (data.not_found.length > 0) {
            message += `\n⚠️ ${data.not_found.length} files not found: ${data.not_found.slice(0, 3).join(', ')}`;
        }
        
        showStatus('analyzeStatus', 'success', message);
        bulkSelectInput.value = '';
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `Selection error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

async function selectPriorityFiles(priorityFileNames) {
    /**
     * Set automatically selected priority files to selected state
     * @param {Array} priorityFileNames - List of priority filenames
     */
    if (!priorityFileNames || priorityFileNames.length === 0) {
        showStatus('analyzeStatus', 'error', 'No priority files to select.');
        return;
    }

    // Clear existing selections
    clearAllSelections();

    // Find and select file by filename
    let selectedCount = 0;
    const notFoundFiles = [];

    priorityFileNames.forEach(fileName => {
        const fileId = findFileIdByName(fileName);
        if (fileId && allFiles[fileId]) {
            allFiles[fileId].selected = true;
            selectedFiles.add(fileId);
            selectedCount++;
        } else {
            notFoundFiles.push(fileName);
        }
    });

    // Update UI
    updateParentDirectories(treeData);
    renderTree();
    updateStatistics();

    // Show result message
    let message = `🎯 Auto-selected ${selectedCount} priority files for architecture analysis.`;
    if (notFoundFiles.length > 0) {
        message += `\n⚠️ ${notFoundFiles.length} files not found: ${notFoundFiles.slice(0, 3).join(', ')}`;
    }
    message += `\n\nYou can now generate the architecture documentation!`;

    showStatus('analyzeStatus', 'success', message);

    // Ask user if they want to start document generation
    setTimeout(() => {
        if (confirm(message + '\n\nWould you like to generate the Architecture Documentation now?')) {
            try {
                // Open document generation modal
                showDocumentationModal();
                // Auto-select architecture option
                setTimeout(() => {
                    try {
                        const architectureRadio = document.querySelector('input[name="docType"][value="architecture"]');
                        if (architectureRadio) {
                            architectureRadio.checked = true;
                        }
                    } catch (error) {
                        console.error('Error setting architecture radio:', error);
                    }
                }, 100);
            } catch (error) {
                console.error('Error opening documentation modal:', error);
                showStatus('analyzeStatus', 'error', 'Failed to open documentation modal. Please try manually.');
            }
        }
    }, 500);
}

function findFileIdByName(fileName) {
    /**
     * Find file ID by filename (searches both relative path and filename)
     * @param {string} fileName - Filename to find
     * @returns {string|null} File ID or null
     */
    for (const [fileId, fileInfo] of Object.entries(allFiles)) {
        const relativePath = fileInfo.relative_path || '';
        const name = fileInfo.name || '';

        // Exact match or match with last part of path
        if (relativePath === fileName ||
            name === fileName ||
            relativePath.endsWith('/' + fileName) ||
            relativePath.includes(fileName)) {
            return fileId;
        }
    }
    return null;
}

function clearAllSelections() {
    /**
     * Deselect all files
     */
    for (const fileId of Object.keys(allFiles)) {
        allFiles[fileId].selected = false;
    }
    selectedFiles.clear();
}

async function performAISelection() {
    const query = aiQueryInput.value.trim();
    
    if (!query) {
        showStatus('analyzeStatus', 'error', 'Please enter an AI search query.');
        return;
    }
    
    if (!treeData) {
        showStatus('analyzeStatus', 'error', 'Please analyze the directory first.');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/ai-select', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: query
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'AI selection failed');
        }
        
        const data = await response.json();
        
        deselectAll();
        
        data.selected_files.forEach(fileId => {
            if (allFiles[fileId]) {
                allFiles[fileId].selected = true;
                selectedFiles.add(fileId);
            }
        });
        
        updateParentDirectories(treeData);
        renderTree();
        updateStatistics();
        
        displayAIResults(data);
        
        showStatus('analyzeStatus', 'success',
            `AI has selected ${data.total_selected} relevant files! (Confidence: ${(data.confidence * 100).toFixed(1)}%)`
        );
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `AI analysis error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function displayAIResults(data) {
    const resultsSection = document.getElementById('aiResultsSection');
    const resultsContent = document.getElementById('aiResultsContent');
    
    let html = `
        <div class="ai-results-header">
            <h4><i class="fas fa-robot"></i> AI Analysis Results</h4>
            <div class="ai-confidence">
                <span>Confidence:</span>
                <strong>${(data.confidence * 100).toFixed(1)}%</strong>
            </div>
        </div>
        
        <div class="ai-reasoning">
            <h5><i class="fas fa-lightbulb"></i> Analysis Reasoning:</h5>
            <p>${data.reasoning}</p>
        </div>
        
        <div class="ai-selected-files">
            <h5><i class="fas fa-check-circle"></i> Selected Files (${data.total_selected}):</h5>
            <ul class="ai-file-list">
    `;
    
    data.file_details.forEach(file => {
        const confidenceClass = file.confidence > 0.8 ? 'high' :
                               file.confidence > 0.5 ? 'medium' : 'low';
        
        html += `
            <li class="ai-file-item">
                <div class="file-path">
                    <i class="fas fa-file-code"></i>
                    <code>${file.relative_path}</code>
                </div>
                <div class="file-reason">
                    <span class="confidence-badge ${confidenceClass}">
                        ${(file.confidence * 100).toFixed(0)}%
                    </span>
                    <span class="reason-text">${file.reason}</span>
                </div>
            </li>
        `;
    });
    
    html += `
            </ul>
        </div>
    `;
    
    resultsContent.innerHTML = html;
    resultsSection.style.display = 'block';
    
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function deselectAll() {
    Object.values(allFiles).forEach(file => {
        file.selected = false;
    });
    selectedFiles.clear();
    selectedDirectories.clear();
}

function renderTree() {
    const container = document.getElementById('fileTree');
    container.innerHTML = '';
    
    if (searchActive && searchResults.length > 0) {
        const searchInfo = document.createElement('div');
        searchInfo.className = 'search-info';
        searchInfo.innerHTML = `<i class="fas fa-search"></i> Search Results: ${searchResults.length} files`;
        container.appendChild(searchInfo);
    }
    
    container.appendChild(createTreeNode(treeData, 0));
}

function createTreeNode(node, level) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';
    
    if (node.children || node.files) {
        const contentDiv = document.createElement('div');
        contentDiv.className = `tree-node-content ${node.selected ? 'selected' : ''}`;
        contentDiv.style.paddingLeft = `${level * 20}px`;
        
        const dirCheckbox = document.createElement('input');
        dirCheckbox.type = 'checkbox';
        dirCheckbox.className = 'tree-checkbox';
        dirCheckbox.checked = node.selected || false;
        dirCheckbox.indeterminate = node.indeterminate || false;
        dirCheckbox.onclick = (e) => {
            e.stopPropagation();
            toggleDirectory(node, dirCheckbox.checked);
        };
        
        const expandIcon = document.createElement('span');
        expandIcon.className = 'tree-icon expand-icon';
        expandIcon.innerHTML = node.expanded ? '▼' : '▶';
        expandIcon.style.cursor = 'pointer';
        expandIcon.onclick = (e) => {
            e.stopPropagation();
            node.expanded = !node.expanded;
            renderTree();
        };
        
        const folderIcon = document.createElement('span');
        folderIcon.className = 'tree-icon';
        folderIcon.innerHTML = node.expanded ? '📂' : '📁';
        
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.name;
        label.style.cursor = 'pointer';
        label.onclick = (e) => {
            e.stopPropagation();
            node.expanded = !node.expanded;
            renderTree();
        };
        
        const info = document.createElement('span');
        info.className = 'tree-info';
        
        const selectedCount = countSelectedInDirectory(node);
        if (selectedCount.selected > 0) {
            info.innerHTML = `<span class="selected-count">${selectedCount.selected}/${selectedCount.total}</span> files, ${formatSize(node.total_size)}`;
        } else {
            info.textContent = `${node.file_count} files, ${formatSize(node.total_size)}`;
        }
        
        contentDiv.appendChild(dirCheckbox);
        contentDiv.appendChild(expandIcon);
        contentDiv.appendChild(folderIcon);
        contentDiv.appendChild(label);
        contentDiv.appendChild(info);
        
        nodeDiv.appendChild(contentDiv);
        
        if (node.expanded) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'tree-children';
            
            if (node.children) {
                node.children.forEach(child => {
                    childrenDiv.appendChild(createTreeNode(child, level + 1));
                });
            }
            
            if (node.files) {
                node.files.forEach(file => {
                    if (!file.hidden) {
                        childrenDiv.appendChild(createFileNode(file, level + 1));
                    }
                });
            }
            
            nodeDiv.appendChild(childrenDiv);
        }
    }
    
    return nodeDiv;
}

function createFileNode(file, level) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'tree-node';
    
    if (searchActive && !file.searchMatch) {
        fileDiv.style.opacity = '0.3';
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = `tree-node-content ${file.selected ? 'selected' : ''} ${file.searchMatch ? 'search-match' : ''}`;
    contentDiv.style.paddingLeft = `${level * 20 + 24}px`;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.checked = file.selected || false;
    checkbox.onchange = (e) => {
        e.stopPropagation();
        toggleFile(file, checkbox.checked);
    };
    
    const fileIcon = document.createElement('span');
    fileIcon.className = 'tree-icon';
    fileIcon.innerHTML = getFileIcon(file.extension);
    
    const label = document.createElement('span');
    label.className = 'tree-label file-label';
    label.textContent = file.relative_path.split('/').pop();
    label.style.cursor = 'pointer';
    label.onclick = () => previewFile(file);
    label.title = 'Click to preview';
    
    if (file.searchMatch) {
        label.innerHTML = highlightText(label.textContent, searchInput.value);
    }
    
    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatSize(file.size);
    
    contentDiv.appendChild(checkbox);
    contentDiv.appendChild(fileIcon);
    contentDiv.appendChild(label);
    contentDiv.appendChild(size);
    
    fileDiv.appendChild(contentDiv);
    
    return fileDiv;
}

function highlightText(text, query) {
    if (!query) return text;
    
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toggleDirectory(node, selected) {
    node.selected = selected;
    
    if (selected) {
        selectedDirectories.add(node.id);
    } else {
        selectedDirectories.delete(node.id);
    }
    
    function toggleAllInDirectory(dirNode, isSelected) {
        if (dirNode.files) {
            dirNode.files.forEach(file => {
                file.selected = isSelected;
                // Immediately update selectedFiles Set
                if (isSelected) {
                    selectedFiles.add(file.id);
                } else {
                    selectedFiles.delete(file.id);
                }
            });
        }
        
        if (dirNode.children) {
            dirNode.children.forEach(child => {
                child.selected = isSelected;
                if (isSelected) {
                    selectedDirectories.add(child.id);
                } else {
                    selectedDirectories.delete(child.id);
                }
                toggleAllInDirectory(child, isSelected);
            });
        }
    }
    
    toggleAllInDirectory(node, selected);
    
    updateParentDirectories(treeData);
    
    renderTree();
    updateStatistics();
}

function toggleFile(file, selected) {
    file.selected = selected;
    
    // Immediately update selectedFiles Set
    if (selected) {
        selectedFiles.add(file.id);
    } else {
        selectedFiles.delete(file.id);
    }
    
    updateParentDirectories(treeData);
    
    renderTree();
    updateStatistics();
}

function updateParentDirectories(node) {
    let allSelected = true;
    let noneSelected = true;
    let childCount = 0;
    
    if (node.files) {
        node.files.forEach(file => {
            childCount++;
            if (file.selected) {
                noneSelected = false;
                // Check if file ID exists in selectedFiles Set and add it
                if (!selectedFiles.has(file.id)) {
                    selectedFiles.add(file.id);
                }
            } else {
                allSelected = false;
                // Remove from selectedFiles Set if not selected
                if (selectedFiles.has(file.id)) {
                    selectedFiles.delete(file.id);
                }
            }
        });
    }
    
    if (node.children) {
        node.children.forEach(child => {
            updateParentDirectories(child);
            childCount++;
            
            if (child.selected || child.indeterminate) {
                noneSelected = false;
            }
            if (!child.selected) {
                allSelected = false;
            }
        });
    }
    
    if (childCount > 0) {
        if (allSelected) {
            node.selected = true;
            node.indeterminate = false;
            selectedDirectories.add(node.id);
        } else if (noneSelected) {
            node.selected = false;
            node.indeterminate = false;
            selectedDirectories.delete(node.id);
        } else {
            node.selected = false;
            node.indeterminate = true;
            selectedDirectories.delete(node.id);
        }
    }
}

function countSelectedInDirectory(node) {
    let total = 0;
    let selected = 0;
    
    if (node.files) {
        node.files.forEach(file => {
            if (!file.hidden) {
                total++;
                if (file.selected) {
                    selected++;
                }
            }
        });
    }
    
    if (node.children) {
        node.children.forEach(child => {
            const childCount = countSelectedInDirectory(child);
            total += childCount.total;
            selected += childCount.selected;
        });
    }
    
    return { total, selected };
}

function getFileIcon(extension) {
    const iconMap = {
        '.py': '🐍',
        '.js': '📜',
        '.jsx': '⚛️',
        '.ts': '📘',
        '.tsx': '⚛️',
        '.html': '🌐',
        '.css': '🎨',
        '.json': '📋',
        '.md': '📝',
        '.txt': '📄',
        '.yml': '⚙️',
        '.yaml': '⚙️',
        '.xml': '📰',
        '.sql': '🗃️',
        '.sh': '🖥️',
        '.dockerfile': '🐳',
        '.gitignore': '🚫',
        '.java': '☕',
        '.c': '🔷',
        '.cpp': '🔷',
        '.cs': '🟦',
        '.go': '🐹',
        '.rs': '🦀',
        '.php': '🐘',
        '.rb': '💎',
        '.swift': '🦉',
        '.kt': '🟠'
    };
    
    return iconMap[extension.toLowerCase()] || '📄';
}

async function previewFile(file) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: file.path })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Preview failed');
        }
        
        const data = await response.json();
        
        document.getElementById('previewTitle').textContent = file.relative_path;
        document.getElementById('previewContent').textContent = data.content;
        document.getElementById('previewModal').style.display = 'flex';
        
    } catch (error) {
        alert(`Preview failed: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function closePreview() {
    document.getElementById('previewModal').style.display = 'none';
}

function selectAll(select) {
    toggleDirectory(treeData, select);
}

function expandAll(expand) {
    function setExpanded(node) {
        node.expanded = expand;
        if (node.children) {
            node.children.forEach(child => setExpanded(child));
        }
    }
    
    setExpanded(treeData);
    renderTree();
}

function filterByExtension() {
    const selected = Array.from(extensionFilter.selectedOptions).map(opt => opt.value);
    
    if (selected.includes('all') || selected.length === 0) {
        Object.values(allFiles).forEach(file => {
            file.hidden = false;
        });
    } else {
        Object.values(allFiles).forEach(file => {
            file.hidden = !selected.includes(file.extension);
        });
    }
    
    renderTree();
}

function populateExtensionFilter() {
    extensionFilter.innerHTML = '<option value="all">All Extensions</option>';
    
    if (statistics && statistics.extensions) {
        statistics.extensions.slice(0, 15).forEach(ext => {
            const option = document.createElement('option');
            option.value = ext.extension;
            option.textContent = `${ext.extension} (${ext.count})`;
            extensionFilter.appendChild(option);
        });
    }
}

function updateStatistics() {
    document.getElementById('totalFiles').textContent = statistics ? statistics.total_files : 0;
    document.getElementById('totalDirs').textContent = statistics ? statistics.total_dirs : 0;
    
    // Recalculate the number and size of selected files to ensure accuracy
    let actualSelectedFiles = new Set();
    let totalSize = 0;
    
    // Find and calculate actually selected files from allFiles
    Object.values(allFiles).forEach(file => {
        if (file.selected) {
            actualSelectedFiles.add(file.id);
            totalSize += file.size || 0;
        }
    });
    
    // Synchronize selectedFiles Set with actually selected files
    selectedFiles = actualSelectedFiles;
    
    document.getElementById('selectedFiles').textContent = selectedFiles.size;
    document.getElementById('selectedSize').textContent = formatSize(totalSize);
    
    const selectedDirCount = document.getElementById('selectedDirs');
    if (selectedDirCount) {
        selectedDirCount.textContent = selectedDirectories.size;
    }
    
    if (statistics && statistics.extensions) {
        const container = document.getElementById('extensionStats');
        container.innerHTML = '';
        
        const selectedByExt = {};
        selectedFiles.forEach(fileId => {
            if (allFiles[fileId]) {
                const ext = allFiles[fileId].extension;
                selectedByExt[ext] = (selectedByExt[ext] || 0) + 1;
            }
        });
        
        statistics.extensions.slice(0, 10).forEach(ext => {
            const selected = selectedByExt[ext.extension] || 0;
            const div = document.createElement('div');
            div.className = 'ext-item';
            
            if (selected > 0) {
                div.innerHTML = `
                    <span class="ext-name">${ext.extension}</span>
                    <span class="ext-count">
                        <span class="selected-count">${selected}</span>/${ext.count} files
                    </span>
                `;
            } else {
                div.innerHTML = `
                    <span class="ext-name">${ext.extension}</span>
                    <span class="ext-count">${ext.count} files</span>
                `;
            }
            
            container.appendChild(div);
        });
    }
    
    document.getElementById('selectedSummary').textContent = 
        `${selectedFiles.size} files selected (${formatSize(totalSize)})`;
}

async function generateMarkdown() {
    if (selectedFiles.size === 0) {
        showStatus('generateStatus', 'error', 'Please select files.');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: Array.from(selectedFiles),
                compression_type: currentCompressionType
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Generation failed');
        }
        
        const data = await response.json();
        lastGeneratedData = data;
        
        const downloadSection = document.getElementById('downloadSection');
        downloadSection.style.display = 'block';
        
        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.href = `/api/download/${data.filename}`;
        
        let message = `${data.file_count} files have been combined.`;
        
        if (data.compression_info) {
            const info = data.compression_info;
            const statsDiv = document.getElementById('compressionStats');
            
            // Handle undefined values safely
            const compressionRatio = info.compression_ratio !== undefined ? info.compression_ratio : 0;
            const originalSize = info.original_size || 0;
            const compressedSize = info.compressed_size || 0;
            const compressionType = info.compression_type || 'unknown';
            
            statsDiv.innerHTML = `
                <div class="stat-row">
                    <span>Compression Type:</span>
                    <strong>${compressionType}</strong>
                </div>
                <div class="stat-row">
                    <span>Original Size:</span>
                    <strong>${formatSize(originalSize)}</strong>
                </div>
                <div class="stat-row">
                    <span>Compressed Size:</span>
                    <strong>${formatSize(compressedSize)}</strong>
                </div>
                <div class="stat-row">
                    <span>Compression Ratio:</span>
                    <strong class="highlight">${compressionRatio}%</strong>
                </div>
                <div class="stat-row">
                    <span>Reduction:</span>
                    <strong class="success">${formatSize(originalSize - compressedSize)} saved</strong>
                </div>
            `;
            statsDiv.style.display = 'block';
        }
        
        const decompressBtn = document.getElementById('decompressBtn');
        if (currentCompressionType === 'lossless' || currentCompressionType === 'hybrid') {
            decompressBtn.style.display = 'inline-flex';
        } else {
            decompressBtn.style.display = 'none';
        }
        
        document.getElementById('downloadMessage').textContent = message;
        
        showStatus('generateStatus', 'success', `✅ Generation complete! ${message}`);
        
    } catch (error) {
        showStatus('generateStatus', 'error', `❌ Error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

document.getElementById('decompressBtn').addEventListener('click', async function() {
    if (!lastGeneratedData) {
        alert('No generated file found.');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`/api/download/${lastGeneratedData.filename}`);
        if (!response.ok) {
            throw new Error('Failed to load compressed file');
        }
        
        const compressedData = await response.json();
        
        const decompressResponse = await fetch('/api/decompress', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: compressedData })
        });
        
        if (!decompressResponse.ok) {
            const error = await decompressResponse.json();
            throw new Error(error.error || 'Decompression failed');
        }
        
        const decompressedData = await decompressResponse.json();
        
        document.getElementById('decompressedContent').textContent = decompressedData.content;
        document.getElementById('decompressModal').style.display = 'flex';
        
    } catch (error) {
        alert(`Decompression failed: ${error.message}`);
    } finally {
        showLoading(false);
    }
});

function closeDecompressModal() {
    document.getElementById('decompressModal').style.display = 'none';
}

document.getElementById('copyDecompressedBtn').addEventListener('click', function() {
    const content = document.getElementById('decompressedContent').textContent;
    navigator.clipboard.writeText(content).then(() => {
        alert('Copied to clipboard!');
    });
});

document.getElementById('downloadDecompressedBtn').addEventListener('click', function() {
    const content = document.getElementById('decompressedContent').textContent;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decompressed_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

function formatSize(bytes) {
    // Handle undefined, null, or non-numeric values
    if (bytes === undefined || bytes === null || isNaN(bytes)) {
        return '0 B';
    }
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function showStatus(elementId, type, message) {
    const element = document.getElementById(elementId);
    element.className = `status-message ${type}`;
    element.textContent = message;
    element.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

let loadingMessages = {
    default: 'Processing...',
    analyzing: 'Analyzing dependencies...',
    analyzing_architecture: 'Analyzing architecture patterns...',
    generating: 'AI is generating documentation...',
    generating_docs: 'Generating architecture documentation...',
    rendering: 'Rendering diagram...'
};

let currentLoadingMessage = 'default';

function showLoading(show, messageType = 'default') {
    const overlay = document.getElementById('loadingOverlay');

    if (!overlay) {
        console.warn('Loading overlay not found');
        return;
    }

    const messageElement = overlay.querySelector('p');

    if (show) {
        currentLoadingMessage = messageType;
        if (messageElement) {
            messageElement.textContent = loadingMessages[messageType] || loadingMessages.default;
        }
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
        currentLoadingMessage = 'default';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.getElementById('step2').style.display !== 'none') {
        e.preventDefault();
        selectAll(true);
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && document.getElementById('step2').style.display !== 'none') {
        e.preventDefault();
        selectAll(false);
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && document.getElementById('step2').style.display !== 'none') {
        e.preventDefault();
        searchInput.focus();
    }
    
    if (e.key === 'Escape') {
        closePreview();
        closeDecompressModal();
        if (searchActive) {
            clearSearch();
        }
    }
});

window.onclick = function(event) {
    const modal = document.getElementById('previewModal');
    if (event.target === modal) {
        closePreview();
    }
    
    const decompressModal = document.getElementById('decompressModal');
    if (event.target === decompressModal) {
        closeDecompressModal();
    }
}

// Compression functionality
const compressionCards = document.querySelectorAll('.compression-card');
compressionCards.forEach(card => {
    card.addEventListener('click', function() {
        const radio = this.querySelector('input[type="radio"]');
        radio.checked = true;
        currentCompressionType = radio.value;
        
        compressionCards.forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
    });
});

// Initialize compression card selection
document.addEventListener('DOMContentLoaded', function() {
    const defaultCard = document.querySelector('.compression-card[data-type="none"]');
    if (defaultCard) {
        defaultCard.classList.add('selected');
    }
});

// Dependency analysis and AI documentation generation functions
let currentDependencyAnalysis = null;

async function analyzeDependencies() {
    if (selectedFiles.size === 0) {
        showStatus('analyzeStatus', 'error', '파일을 먼저 선택해주세요.');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch('/api/analyze-dependencies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: Array.from(selectedFiles)
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Dependency analysis failed');
        }
        
        const data = await response.json();
        currentDependencyAnalysis = data.analysis;
        
        displayDependencyAnalysis(data.analysis);
        
        showStatus('analyzeStatus', 'success',
            `Dependency analysis complete! Completeness: ${data.analysis.completeness_score}%`
        );
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `Dependency analysis error: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

function displayDependencyAnalysis(analysis) {
    const resultsSection = document.getElementById('dependencyResults');
    const resultsContent = document.getElementById('dependencyResultsContent');
    
    const metrics = analysis.metrics;
    const missing = analysis.missing_dependencies;
    const cycles = analysis.circular_dependencies;
    
    let html = `
        <div class="dependency-header">
            <h3><i class="fas fa-project-diagram"></i> Dependency Analysis Results</h3>
            <div class="completeness-badge ${getCompletenessBadgeClass(analysis.completeness_score)}">
                Completeness: ${analysis.completeness_score}%
            </div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-icon"><i class="fas fa-file-code"></i></div>
                <div class="metric-value">${metrics.total_files}</div>
                <div class="metric-label">Total Files</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon"><i class="fas fa-door-open"></i></div>
                <div class="metric-value">${metrics.entry_points}</div>
                <div class="metric-label">Entry Points</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon"><i class="fas fa-leaf"></i></div>
                <div class="metric-value">${metrics.leaf_nodes}</div>
                <div class="metric-label">Leaf Nodes</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-icon"><i class="fas fa-link"></i></div>
                <div class="metric-value">${metrics.average_dependencies}</div>
                <div class="metric-label">Avg Dependencies</div>
            </div>
            
            <div class="metric-card ${metrics.coupling_score > 50 ? 'warning' : ''}">
                <div class="metric-icon"><i class="fas fa-compress-arrows-alt"></i></div>
                <div class="metric-value">${metrics.coupling_score}%</div>
                <div class="metric-label">Coupling</div>
            </div>
        </div>
    `;
    
    if (missing.length > 0) {
        html += `
            <div class="missing-dependencies-section">
                <h4><i class="fas fa-exclamation-triangle"></i> Missing Dependencies (${missing.length})</h4>
                <div class="missing-deps-list">
        `;
        
        missing.forEach(dep => {
            html += `
                <div class="missing-dep-item">
                    <div class="dep-info">
                        <div class="required-by">
                            <i class="fas fa-file"></i>
                            <code>${dep.required_by_path}</code>
                        </div>
                        <div class="missing-import">
                            <i class="fas fa-arrow-right"></i>
                            <code>${dep.missing_import}</code>
                        </div>
                        <div class="dep-reason">${dep.reason}</div>
                    </div>
                    ${dep.suggested_file ? `
                        <button class="btn btn-sm btn-success add-dep-btn"
                                data-file-id="${dep.suggested_file}"
                                data-confidence="${dep.confidence}">
                            <i class="fas fa-plus"></i> Add (${(dep.confidence * 100).toFixed(0)}%)
                        </button>
                    ` : ''}
                </div>
            `;
        });
        
        html += `
                </div>
                <button id="addAllMissingBtn" class="btn btn-primary">
                    <i class="fas fa-plus-circle"></i> Add All Missing Files
                </button>
            </div>
        `;
    }
    
    if (cycles.length > 0) {
        html += `
            <div class="circular-deps-section warning-section">
                <h4><i class="fas fa-exclamation-circle"></i> Circular Dependencies Warning (${cycles.length})</h4>
                <p class="warning-text">Circular dependencies can make code maintenance difficult.</p>
                <div class="cycles-list">
        `;
        
        cycles.forEach((cycle, index) => {
            const cycleFiles = cycle.map(fileId => {
                const file = allFiles[fileId];
                return file ? file.relative_path : fileId;
            });
            
            html += `
                <div class="cycle-item">
                    <strong>Cycle ${index + 1}:</strong>
                    <div class="cycle-path">
                        ${cycleFiles.map((f, i) => `
                            <span class="cycle-file">${f}</span>
                            ${i < cycleFiles.length - 1 ? '<i class="fas fa-arrow-right"></i>' : ''}
                        `).join('')}
                        <i class="fas fa-redo"></i>
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    html += `
        <div class="dependency-graph-section">
            <h4><i class="fas fa-sitemap"></i> Dependency Graph</h4>
            <div id="dependencyGraph" class="graph-container"></div>
        </div>
    `;
    
    resultsContent.innerHTML = html;
    resultsSection.style.display = 'block';
    
    document.querySelectorAll('.add-dep-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const fileId = this.dataset.fileId;
            addMissingDependency([fileId]);
        });
    });
    
    const addAllBtn = document.getElementById('addAllMissingBtn');
    if (addAllBtn) {
        addAllBtn.addEventListener('click', function() {
            const fileIds = missing
                .filter(d => d.suggested_file)
                .map(d => d.suggested_file);
            addMissingDependency(fileIds);
        });
    }
    
    renderDependencyGraph(analysis.graph);
    
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    const archRequirement = document.getElementById('archRequirement');
    if (archRequirement && analysis) {
        archRequirement.className = 'requirement-badge ready';
        archRequirement.innerHTML = '<i class="fas fa-check"></i> Analysis Complete';
    }

    const mermaidArchRequirement = document.getElementById('mermaidArchRequirement');
    if (mermaidArchRequirement && analysis) {
        mermaidArchRequirement.className = 'requirement-badge ready';
        mermaidArchRequirement.innerHTML = '<i class="fas fa-check"></i> Analysis Complete';
    }
}

function getCompletenessBadgeClass(score) {
    if (score >= 90) return 'high';
    if (score >= 70) return 'medium';
    return 'low';
}

async function addMissingDependency(fileIds) {
    showLoading(true);
    
    try {
        const response = await fetch('/api/add-missing-dependencies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file_ids: fileIds
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add dependencies');
        }
        
        const data = await response.json();
        
        data.added_files.forEach(fileId => {
            if (allFiles[fileId]) {
                allFiles[fileId].selected = true;
                selectedFiles.add(fileId);
            }
        });
        
        updateParentDirectories(treeData);
        renderTree();
        updateStatistics();
        
        showStatus('analyzeStatus', 'success',
            `${data.count} files have been added!`
        );
        
        await analyzeDependencies();
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `Error adding files: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

let dependencyGraphInstance = null;

function renderDependencyGraph(graphData) {
    const container = document.getElementById('dependencyGraph');
    
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
        container.innerHTML = '<p class="no-data">No data to display.</p>';
        return;
    }
    
    container.innerHTML = '';
    
    dependencyGraphInstance = new InteractiveDependencyGraph('dependencyGraph', graphData);
}

class InteractiveDependencyGraph {
    constructor(containerId, graphData) {
        this.container = d3.select(`#${containerId}`);
        this.graphData = graphData;
        this.width = this.container.node().clientWidth;
        this.height = 600;
        this.selectedNode = null;
        this.highlightedPath = new Set();
        this.currentLayout = 'force';
        
        this.init();
    }
    
    init() {
        this.container.html('');
        
        const controlsDiv = this.container.append('div')
            .attr('class', 'graph-controls');
        
        this.createControls(controlsDiv);
        
        const mainContainer = this.container.append('div')
            .attr('class', 'graph-main-container')
            .style('position', 'relative')
            .style('display', 'flex')
            .style('gap', '1rem');
        
        const svgContainer = mainContainer.append('div')
            .attr('class', 'graph-svg-container')
            .style('flex', '1')
            .style('position', 'relative');
        
        this.svg = svgContainer.append('svg')
            .attr('width', '100%')
            .attr('height', this.height)
            .attr('id', 'depGraphSvg');
        
        this.svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('svg:path')
            .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
            .attr('fill', '#999');
        
        this.g = this.svg.append('g');
        
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
                this.updateMinimap();
            });
        
        this.svg.call(zoom);
        
        this.detailPanel = mainContainer.append('div')
            .attr('class', 'graph-detail-panel')
            .style('width', '300px')
            .style('display', 'none');
        
        this.createMinimap(svgContainer);
        
        this.renderGraph();
    }
    
    createControls(container) {
        const toolbar = container.append('div')
            .attr('class', 'graph-toolbar');
        
        const layoutGroup = toolbar.append('div')
            .attr('class', 'control-group');
        
        layoutGroup.append('label')
            .text('Layout:')
            .style('margin-right', '0.5rem');
        
        const layoutSelect = layoutGroup.append('select')
            .attr('class', 'graph-control-select')
            .on('change', (event) => {
                this.currentLayout = event.target.value;
                this.renderGraph();
            });
        
        layoutSelect.selectAll('option')
            .data([
                {value: 'force', label: 'Force-Directed'},
                {value: 'hierarchical', label: 'Hierarchical'},
                {value: 'circular', label: 'Circular'}
            ])
            .enter()
            .append('option')
            .attr('value', d => d.value)
            .text(d => d.label);
        
        const filterGroup = toolbar.append('div')
            .attr('class', 'control-group');
        
        filterGroup.append('label')
            .text('Filter:')
            .style('margin-right', '0.5rem');
        
        const filterButtons = [
            {id: 'all', label: 'All', icon: 'fa-circle'},
            {id: 'entry', label: 'Entry', icon: 'fa-sign-in-alt'},
            {id: 'leaf', label: 'Leaf', icon: 'fa-leaf'}
        ];
        
        filterButtons.forEach(btn => {
            filterGroup.append('button')
                .attr('class', 'btn btn-sm graph-filter-btn')
                .attr('data-filter', btn.id)
                .html(`<i class="fas ${btn.icon}"></i> ${btn.label}`)
                .on('click', () => this.applyFilter(btn.id));
        });
        
        const searchGroup = toolbar.append('div')
            .attr('class', 'control-group');
        
        searchGroup.append('input')
            .attr('type', 'text')
            .attr('class', 'graph-search-input')
            .attr('placeholder', 'Search nodes...')
            .on('input', (event) => this.searchNodes(event.target.value));
        
        const actionGroup = toolbar.append('div')
            .attr('class', 'control-group');
        
        actionGroup.append('button')
            .attr('class', 'btn btn-sm')
            .html('<i class="fas fa-search-plus"></i> Zoom In')
            .on('click', () => this.zoomIn());
        
        actionGroup.append('button')
            .attr('class', 'btn btn-sm')
            .html('<i class="fas fa-search-minus"></i> Zoom Out')
            .on('click', () => this.zoomOut());
        
        actionGroup.append('button')
            .attr('class', 'btn btn-sm')
            .html('<i class="fas fa-expand"></i> Fit View')
            .on('click', () => this.fitToView());
        
        actionGroup.append('button')
            .attr('class', 'btn btn-sm')
            .html('<i class="fas fa-download"></i> Export')
            .on('click', () => this.exportGraph());
    }
    
    createMinimap(container) {
        const minimapContainer = container.append('div')
            .attr('class', 'graph-minimap')
            .style('position', 'absolute')
            .style('bottom', '10px')
            .style('right', '10px')
            .style('width', '150px')
            .style('height', '100px')
            .style('border', '2px solid #667eea')
            .style('background', 'white')
            .style('border-radius', '4px')
            .style('overflow', 'hidden');
        
        this.minimapSvg = minimapContainer.append('svg')
            .attr('width', '100%')
            .attr('height', '100%');
        
        this.minimapG = this.minimapSvg.append('g');
    }

    renderGraph() {
        this.g.selectAll('*').remove();
        
        const nodes = this.graphData.nodes.map(d => ({...d}));
        const links = this.graphData.edges.map(d => ({...d}));
        
        let simulation;
        
        switch(this.currentLayout) {
            case 'hierarchical':
                simulation = this.createHierarchicalLayout(nodes, links);
                break;
            case 'circular':
                simulation = this.createCircularLayout(nodes, links);
                break;
            default:
                simulation = this.createForceLayout(nodes, links);
        }
        
        this.link = this.g.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(links)
            .enter()
            .append('line')
            .attr('class', 'graph-link')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2)
            .attr('marker-end', 'url(#arrowhead)');
        
        const nodeGroup = this.g.append('g')
            .attr('class', 'nodes')
            .selectAll('g')
            .data(nodes)
            .enter()
            .append('g')
            .attr('class', 'graph-node')
            .call(d3.drag()
                .on('start', (event, d) => this.dragstarted(event, d, simulation))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragended(event, d, simulation)));
        
        nodeGroup.append('circle')
            .attr('r', d => this.getNodeSize(d))
            .attr('fill', d => this.getNodeColor(d))
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer');
        
        nodeGroup.append('text')
            .text(d => d.label)
            .attr('x', 0)
            .attr('y', d => this.getNodeSize(d) + 15)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('fill', '#333')
            .style('pointer-events', 'none');
        
        nodeGroup.on('click', (event, d) => {
            event.stopPropagation();
            this.selectNode(d);
        });
        
        nodeGroup.on('mouseenter', (event, d) => {
            this.highlightConnections(d);
        });
        
        nodeGroup.on('mouseleave', () => {
            this.clearHighlight();
        });
        
        this.node = nodeGroup;
        
        if (this.currentLayout === 'force') {
            simulation.on('tick', () => {
                this.link
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);
                
                this.node.attr('transform', d => `translate(${d.x},${d.y})`);
            });
        }
        
        this.renderMinimap(nodes, links);
    }
    
    createForceLayout(nodes, links) {
        return d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links)
                .id(d => d.id)
                .distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(40));
    }
    
    createHierarchicalLayout(nodes, links) {
        const hierarchy = this.buildHierarchy(nodes, links);
        const treeLayout = d3.tree()
            .size([this.width - 100, this.height - 100]);
        
        const root = d3.hierarchy(hierarchy);
        treeLayout(root);
        
        root.descendants().forEach(d => {
            const node = nodes.find(n => n.id === d.data.id);
            if (node) {
                node.x = d.x + 50;
                node.y = d.y + 50;
                node.fx = node.x;
                node.fy = node.y;
            }
        });
        
        this.link
            .attr('x1', d => {
                const source = nodes.find(n => n.id === d.source);
                return source ? source.x : 0;
            })
            .attr('y1', d => {
                const source = nodes.find(n => n.id === d.source);
                return source ? source.y : 0;
            })
            .attr('x2', d => {
                const target = nodes.find(n => n.id === d.target);
                return target ? target.x : 0;
            })
            .attr('y2', d => {
                const target = nodes.find(n => n.id === d.target);
                return target ? target.y : 0;
            });
        
        this.node.attr('transform', d => `translate(${d.x},${d.y})`);
        
        return d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(0).strength(0))
            .stop();
    }
    
    createCircularLayout(nodes, links) {
        const radius = Math.min(this.width, this.height) / 2 - 100;
        const angleStep = (2 * Math.PI) / nodes.length;
        
        nodes.forEach((node, i) => {
            const angle = i * angleStep;
            node.x = this.width / 2 + radius * Math.cos(angle);
            node.y = this.height / 2 + radius * Math.sin(angle);
            node.fx = node.x;
            node.fy = node.y;
        });
        
        this.link
            .attr('x1', d => {
                const source = nodes.find(n => n.id === d.source);
                return source ? source.x : 0;
            })
            .attr('y1', d => {
                const source = nodes.find(n => n.id === d.source);
                return source ? source.y : 0;
            })
            .attr('x2', d => {
                const target = nodes.find(n => n.id === d.target);
                return target ? target.x : 0;
            })
            .attr('y2', d => {
                const target = nodes.find(n => n.id === d.target);
                return target ? target.y : 0;
            });
        
        this.node.attr('transform', d => `translate(${d.x},${d.y})`);
        
        return d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(0).strength(0))
            .stop();
    }
    
    buildHierarchy(nodes, links) {
        const entryPoints = nodes.filter(n => n.is_entry_point);
        
        if (entryPoints.length === 0) {
            return {
                id: 'root',
                label: 'Root',
                children: nodes.map(n => ({
                    id: n.id,
                    label: n.label,
                    children: []
                }))
            };
        }
        
        const buildChildren = (nodeId, visited = new Set()) => {
            if (visited.has(nodeId)) return [];
            visited.add(nodeId);
            
            const children = links
                .filter(l => l.source === nodeId || (l.source.id && l.source.id === nodeId))
                .map(l => {
                    const targetId = l.target.id || l.target;
                    const targetNode = nodes.find(n => n.id === targetId);
                    if (!targetNode) return null;
                    
                    return {
                        id: targetNode.id,
                        label: targetNode.label,
                        children: buildChildren(targetId, new Set(visited))
                    };
                })
                .filter(c => c !== null);
            
            return children;
        };
        
        return {
            id: 'root',
            label: 'Root',
            children: entryPoints.map(ep => ({
                id: ep.id,
                label: ep.label,
                children: buildChildren(ep.id)
            }))
        };
    }
    
    getNodeSize(node) {
        const baseSize = 20;
        const sizeMultiplier = Math.log(node.dependency_count + node.dependent_count + 1) * 5;
        return Math.min(baseSize + sizeMultiplier, 40);
    }
    
    getNodeColor(node) {
        if (node.is_entry_point) return '#48bb78';
        if (node.is_leaf) return '#ed8936';
        return '#667eea';
    }
    
    selectNode(node) {
        this.selectedNode = node;
        
        this.node.selectAll('circle')
            .attr('stroke-width', d => d.id === node.id ? 4 : 2)
            .attr('stroke', d => d.id === node.id ? '#f6ad55' : '#fff');
        
        this.showDetailPanel(node);
        
        this.highlightPath(node);
    }
    
    highlightPath(node) {
        this.highlightedPath.clear();
        
        const findConnected = (nodeId, direction = 'both') => {
            this.highlightedPath.add(nodeId);
            
            this.graphData.edges.forEach(edge => {
                if (direction !== 'target' && edge.source === nodeId) {
                    if (!this.highlightedPath.has(edge.target)) {
                        findConnected(edge.target, 'source');
                    }
                }
                if (direction !== 'source' && edge.target === nodeId) {
                    if (!this.highlightedPath.has(edge.source)) {
                        findConnected(edge.source, 'target');
                    }
                }
            });
        };
        
        findConnected(node.id);
        
        this.node.style('opacity', d =>
            this.highlightedPath.has(d.id) ? 1 : 0.2
        );
        
        this.link.style('opacity', d =>
            this.highlightedPath.has(d.source.id || d.source) &&
            this.highlightedPath.has(d.target.id || d.target) ? 1 : 0.1
        );
    }
    
    highlightConnections(node) {
        const connectedNodes = new Set([node.id]);
        
        this.graphData.edges.forEach(edge => {
            if (edge.source === node.id || edge.source.id === node.id) {
                connectedNodes.add(edge.target.id || edge.target);
            }
            if (edge.target === node.id || edge.target.id === node.id) {
                connectedNodes.add(edge.source.id || edge.source);
            }
        });
        
        this.node.style('opacity', d =>
            connectedNodes.has(d.id) ? 1 : 0.3
        );
        
        this.link.style('opacity', d => {
            const sourceId = d.source.id || d.source;
            const targetId = d.target.id || d.target;
            return (sourceId === node.id || targetId === node.id) ? 1 : 0.1;
        });
    }
    
    clearHighlight() {
        if (!this.selectedNode) {
            this.node.style('opacity', 1);
            this.link.style('opacity', 0.6);
        }
    }
    
    showDetailPanel(node) {
        this.detailPanel.style('display', 'block');
        
        const dependencies = this.graphData.edges
            .filter(e => (e.source.id || e.source) === node.id)
            .map(e => {
                const targetId = e.target.id || e.target;
                const targetNode = this.graphData.nodes.find(n => n.id === targetId);
                return targetNode ? targetNode.label : targetId;
            });
        
        const dependents = this.graphData.edges
            .filter(e => (e.target.id || e.target) === node.id)
            .map(e => {
                const sourceId = e.source.id || e.source;
                const sourceNode = this.graphData.nodes.find(n => n.id === sourceId);
                return sourceNode ? sourceNode.label : sourceId;
            });
        
        this.detailPanel.html(`
            <div class="detail-panel-header">
                <h4><i class="fas fa-info-circle"></i> 노드 정보</h4>
                <button class="btn-close" onclick="dependencyGraphInstance.closeDetailPanel()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="detail-panel-content">
                <div class="detail-section">
                    <h5><i class="fas fa-file"></i> 파일명</h5>
                    <p class="detail-filename">${node.label}</p>
                    <p class="detail-path">${node.path}</p>
                </div>
                
                <div class="detail-section">
                    <h5><i class="fas fa-tag"></i> 유형</h5>
                    <div class="detail-badges">
                        ${node.is_entry_point ? '<span class="badge badge-success">진입점</span>' : ''}
                        ${node.is_leaf ? '<span class="badge badge-warning">리프 노드</span>' : ''}
                        <span class="badge badge-info">${node.type}</span>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h5><i class="fas fa-chart-bar"></i> 통계</h5>
                    <div class="detail-stats">
                        <div class="stat-item">
                            <span>의존성 수:</span>
                            <strong>${node.dependency_count}</strong>
                        </div>
                        <div class="stat-item">
                            <span>의존 파일 수:</span>
                            <strong>${node.dependent_count}</strong>
                        </div>
                    </div>
                </div>
                
                ${dependencies.length > 0 ? `
                    <div class="detail-section">
                        <h5><i class="fas fa-arrow-right"></i> 의존하는 파일 (${dependencies.length})</h5>
                        <ul class="detail-list">
                            ${dependencies.slice(0, 5).map(d => `<li>${d}</li>`).join('')}
                            ${dependencies.length > 5 ? `<li class="more">... 외 ${dependencies.length - 5}개</li>` : ''}
                        </ul>
                    </div>
                ` : ''}
                
                ${dependents.length > 0 ? `
                    <div class="detail-section">
                        <h5><i class="fas fa-arrow-left"></i> 이 파일을 의존하는 파일 (${dependents.length})</h5>
                        <ul class="detail-list">
                            ${dependents.slice(0, 5).map(d => `<li>${d}</li>`).join('')}
                            ${dependents.length > 5 ? `<li class="more">... 외 ${dependents.length - 5}개</li>` : ''}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `);
    }
    
    closeDetailPanel() {
        this.detailPanel.style('display', 'none');
        this.selectedNode = null;
        this.highlightedPath.clear();
        
        this.node.selectAll('circle')
            .attr('stroke-width', 2)
            .attr('stroke', '#fff');
        
        this.node.style('opacity', 1);
        this.link.style('opacity', 0.6);
    }
    
    applyFilter(filterType) {
        d3.selectAll('.graph-filter-btn').classed('active', false);
        d3.select(`[data-filter="${filterType}"]`).classed('active', true);
        
        this.node.style('display', d => {
            switch(filterType) {
                case 'entry':
                    return d.is_entry_point ? 'block' : 'none';
                case 'leaf':
                    return d.is_leaf ? 'block' : 'none';
                default:
                    return 'block';
            }
        });
        
        this.link.style('display', d => {
            const sourceNode = this.graphData.nodes.find(n =>
                n.id === (d.source.id || d.source)
            );
            const targetNode = this.graphData.nodes.find(n =>
                n.id === (d.target.id || d.target)
            );
            
            const sourceVisible = this.node.filter(n => n.id === sourceNode?.id)
                .style('display') !== 'none';
            const targetVisible = this.node.filter(n => n.id === targetNode?.id)
                .style('display') !== 'none';
            
            return (sourceVisible && targetVisible) ? 'block' : 'none';
        });
    }
    
    searchNodes(query) {
        if (!query) {
            this.node.style('opacity', 1);
            this.link.style('opacity', 0.6);
            return;
        }
        
        const lowerQuery = query.toLowerCase();
        const matchedNodes = new Set();
        
        this.graphData.nodes.forEach(node => {
            if (node.label.toLowerCase().includes(lowerQuery) ||
                node.path.toLowerCase().includes(lowerQuery)) {
                matchedNodes.add(node.id);
            }
        });
        
        this.node.style('opacity', d =>
            matchedNodes.has(d.id) ? 1 : 0.2
        );
        
        this.link.style('opacity', 0.1);
    }
    
    renderMinimap(nodes, links) {
        this.minimapG.selectAll('*').remove();
        
        const minimapWidth = 150;
        const minimapHeight = 100;
        
        const xExtent = d3.extent(nodes, d => d.x);
        const yExtent = d3.extent(nodes, d => d.y);
        
        const xScale = d3.scaleLinear()
            .domain(xExtent)
            .range([5, minimapWidth - 5]);
        
        const yScale = d3.scaleLinear()
            .domain(yExtent)
            .range([5, minimapHeight - 5]);
        
        this.minimapG.selectAll('line')
            .data(links)
            .enter()
            .append('line')
            .attr('x1', d => xScale(d.source.x || 0))
            .attr('y1', d => yScale(d.source.y || 0))
            .attr('x2', d => xScale(d.target.x || 0))
            .attr('y2', d => yScale(d.target.y || 0))
            .attr('stroke', '#ccc')
            .attr('stroke-width', 0.5);
        
        this.minimapG.selectAll('circle')
            .data(nodes)
            .enter()
            .append('circle')
            .attr('cx', d => xScale(d.x))
            .attr('cy', d => yScale(d.y))
            .attr('r', 2)
            .attr('fill', d => this.getNodeColor(d));
    }
    
    updateMinimap() {
    }
    
    zoomIn() {
        this.svg.transition().call(
            d3.zoom().scaleBy, 1.3
        );
    }
    
    zoomOut() {
        this.svg.transition().call(
            d3.zoom().scaleBy, 0.7
        );
    }
    
    fitToView() {
        const bounds = this.g.node().getBBox();
        const parent = this.svg.node().parentElement;
        const fullWidth = parent.clientWidth;
        const fullHeight = this.height;
        
        const width = bounds.width;
        const height = bounds.height;
        
        const midX = bounds.x + width / 2;
        const midY = bounds.y + height / 2;
        
        const scale = 0.9 / Math.max(width / fullWidth, height / fullHeight);
        const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];
        
        this.svg.transition()
            .duration(750)
            .call(
                d3.zoom().transform,
                d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
            );
    }
    
    exportGraph() {
        const svgElement = document.getElementById('depGraphSvg');
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgElement);
        
        const blob = new Blob([svgString], {type: 'image/svg+xml'});
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `dependency-graph-${Date.now()}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    dragstarted(event, d, simulation) {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    dragended(event, d, simulation) {
        if (!event.active && simulation) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
}

function showDocumentationModal() {
    if (selectedFiles.size === 0) {
        showStatus('analyzeStatus', 'error', '문서를 생성할 파일을 먼저 선택해주세요.');
        return;
    }
    
    document.getElementById('documentationModal').style.display = 'flex';
}

function closeDocumentationModal() {
    document.getElementById('documentationModal').style.display = 'none';
}

function showConfirmDialog(title, message, confirmText, cancelText) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal confirm-modal';
        modal.style.display = 'flex';
        
        modal.innerHTML = `
            <div class="modal-content confirm-content">
                <div class="modal-header">
                    <h3><i class="fas fa-question-circle"></i> ${title}</h3>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary confirm-cancel">${cancelText}</button>
                    <button class="btn btn-primary confirm-ok">${confirmText}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const okBtn = modal.querySelector('.confirm-ok');
        const cancelBtn = modal.querySelector('.confirm-cancel');
        
        okBtn.onclick = () => {
            document.body.removeChild(modal);
            resolve(true);
        };
        
        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            resolve(false);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(false);
            }
        };
    });
}

async function analyzeDependencies() {
    if (selectedFiles.size === 0) {
        showStatus('analyzeStatus', 'error', '파일을 먼저 선택해주세요.');
        return;
    }
    
    showLoading(true, 'analyzing');
    
    try {
        const response = await fetch('/api/analyze-dependencies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: Array.from(selectedFiles)
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Dependency analysis failed');
        }
        
        const data = await response.json();
        currentDependencyAnalysis = data.analysis;
        
        displayDependencyAnalysis(data.analysis);
        
        showStatus('analyzeStatus', 'success',
            `Dependency analysis complete! Completeness: ${data.analysis.completeness_score}%`
        );
        
        return data.analysis;
        
    } catch (error) {
        showStatus('analyzeStatus', 'error', `의존성 분석 오류: ${error.message}`);
        throw error;
    } finally {
        showLoading(false);
    }
}

function getDocTypeName(docType) {
    const names = {
        'readme': 'README',
        'api_docs': 'API 문서',
        'architecture': 'Architecture Documentation',
        'summary': 'Code Summary'
    };
    return names[docType] || docType;
}

function displayGeneratedDocumentation(data) {
    const modal = document.getElementById('documentationPreviewModal');
    const title = document.getElementById('docPreviewTitle');
    const content = document.getElementById('docPreviewContent');
    
    title.textContent = `${getDocTypeName(data.doc_type)} Preview`;
    
    const converter = new showdown.Converter({
        tables: true,
        tasklists: true,
        strikethrough: true,
        emoji: true
    });
    
    let markdownContent = data.content;
    
    const mermaidBlocks = [];
    markdownContent = markdownContent.replace(/```mermaid\n([\s\S]*?)```/g, (match, diagram) => {
        const id = `mermaid-${mermaidBlocks.length}`;
        mermaidBlocks.push({ id, diagram: diagram.trim() });
        return `<div class="mermaid-container" id="${id}"></div>`;
    });
    
    const htmlContent = converter.makeHtml(markdownContent);
    content.innerHTML = htmlContent;
    
    setTimeout(() => {
        mermaidBlocks.forEach(({ id, diagram }) => {
            renderEnhancedMermaidDiagram(id, diagram);
        });
    }, 100);
    
    document.getElementById('downloadDocBtn').onclick = () => {
        downloadDocumentation(data.filename, data.content);
    };
    
    document.getElementById('copyDocBtn').onclick = () => {
        navigator.clipboard.writeText(data.content).then(() => {
            showStatus('analyzeStatus', 'success', '문서가 클립보드에 복사되었습니다!');
        });
    };
    
    modal.style.display = 'flex';
}

function downloadDocumentation(filename, content) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function closeDocPreviewModal() {
    document.getElementById('documentationPreviewModal').style.display = 'none';
}

// Language Selection Variables
let selectedLanguage = "en"; // Default to English
const languageSelect = document.getElementById("languageSelect");
const customLanguageInput = document.getElementById("customLanguageInput");
const customLanguageCode = document.getElementById("customLanguageCode");
const applyCustomLanguage = document.getElementById("applyCustomLanguage");

// Language Selection Event Listeners
languageSelect.addEventListener("change", handleLanguageChange);
applyCustomLanguage.addEventListener("click", applyCustomLanguageSelection);

// Language Selection Functions
function handleLanguageChange() {
    const selectedValue = languageSelect.value;

    if (selectedValue === "custom") {
        customLanguageInput.style.display = "flex";
        customLanguageCode.focus();
        selectedLanguage = "en"; // Reset to English until custom language is applied
    } else {
        customLanguageInput.style.display = "none";
        customLanguageCode.value = "";
        selectedLanguage = selectedValue;
        console.log("Language selected:", selectedLanguage);
    }
}

function applyCustomLanguageSelection() {
    const customCode = customLanguageCode.value.trim();

    if (customCode && /^[a-z]{2}(-[A-Z]{2})?$/.test(customCode)) {
        selectedLanguage = customCode;
        console.log("Custom language applied:", selectedLanguage);

        // Update the select to show the custom code
        const customOption = document.createElement("option");
        customOption.value = customCode;
        customOption.textContent = `${customCode.toUpperCase()} (Custom)`;
        customOption.selected = true;

        // Remove previous custom option if exists
        const previousCustom = languageSelect.querySelector('option[value^="fr"], option[value^="it"], option[value^="pt"]');
        if (previousCustom) {
            previousCustom.remove();
        }

        languageSelect.insertBefore(customOption, languageSelect.querySelector('option[value="custom"]'));
        customLanguageInput.style.display = "none";

        // Show success message
        showStatus(`Language set to ${customCode.toUpperCase()}.`, "success");
    } else {
        showStatus("Please enter a valid language code (e.g., fr, it, pt, en-US)", "error");
    }
}

function getSelectedLanguage() {
    return selectedLanguage;
}

// Initialize language selection
document.addEventListener("DOMContentLoaded", function() {
    // Set default language to English
    if (languageSelect) {
        languageSelect.value = "en";
        selectedLanguage = "en";
    }
});

/**
 * Enhanced Mermaid diagram rendering with advanced error handling and interactivity
 */
/**
 * Pre-render syntax check to catch common Mermaid issues before rendering
 */
function preRenderSyntaxCheck(diagramCode) {
    const errors = [];
    const lines = diagramCode.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;

        if (!line || line.startsWith('%%')) {
            continue;
        }

        // Check for trailing commas in classDef statements
        if (line.startsWith('classDef ')) {
            if (line.endsWith(',')) {
                errors.push(`Line ${lineNum}: classDef statement ends with trailing comma`);
            }

            // Check for incomplete classDef properties
            const properties = line.replace(/^classDef\s+\w+\s+/, '');
            if (properties.endsWith(',')) {
                errors.push(`Line ${lineNum}: classDef properties end with trailing comma`);
            }
        }

        // Check for concatenated classDef statements
        if (line.includes('classDef') && line.includes('classDef', line.indexOf('classDef') + 1)) {
            errors.push(`Line ${lineNum}: Multiple classDef statements on same line - need line breaks`);
        }

        // Check for malformed arrow syntax
        if (line.includes('-->') && !line.includes(' ')) {
            errors.push(`Line ${lineNum}: Arrow syntax needs spaces around operators`);
        }

        // Check for incomplete node definitions
        if (line.includes('[') && !line.includes(']')) {
            errors.push(`Line ${lineNum}: Unclosed square brackets`);
        }
        if (line.includes('(') && !line.includes(')')) {
            errors.push(`Line ${lineNum}: Unclosed parentheses`);
        }
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

async function renderEnhancedMermaidDiagram(containerId, diagramCode) {
    const container = document.getElementById(containerId);

    if (!container) {
        console.error(`Container ${containerId} not found`);
        return;
    }

    try {
        // Enhanced validation
        const validation = getMermaidValidation(diagramCode);

        if (validation.errors && validation.errors.length > 0) {
            // Critical errors found - don't attempt rendering
            console.error(`Critical Mermaid syntax errors for ${containerId}:`, validation.errors);

            container.innerHTML = `
                <div class="mermaid-error-container">
                    <div class="mermaid-error-header">
                        <h4><i class="fas fa-exclamation-triangle"></i> Mermaid Syntax Errors</h4>
                        <button class="mermaid-btn retry" onclick="retryDiagramRendering('${containerId}')">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                    </div>
                    <div class="mermaid-error-content">
                        <p><strong>Found ${validation.errors.length} syntax error(s):</strong></p>
                        <ul>
                            ${validation.errors.map(error => `<li>${error}</li>`).join('')}
                        </ul>
                        <details>
                            <summary>View Diagram Code</summary>
                            <pre><code>${escapeHtml(diagramCode)}</code></pre>
                        </details>
                        <div class="error-suggestions">
                            <h5>Suggestions:</h5>
                            <ul>
                                <li>Check node ID format (must start with letter/underscore)</li>
                                <li>Ensure all brackets are matched: [], (), {}</li>
                                <li>Verify subgraph declarations have matching 'end'</li>
                                <li>Make sure graph type is declared (graph, flowchart, etc.)</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // Enhanced validation with critical error detection
        if (validation.warnings && validation.warnings.length > 0) {
            console.warn(`Diagram validation warnings for ${containerId}:`, validation.warnings);

            // Check for critical syntax errors that would prevent rendering
            const criticalErrors = validation.warnings.filter(warning =>
                warning.includes('Parse error') ||
                warning.includes('trailing comma') ||
                warning.includes('classDef') ||
                warning.includes('syntax')
            );

            if (criticalErrors.length > 0) {
                container.innerHTML = `
                    <div class="mermaid-error">
                        <div class="error-icon">⚠️</div>
                        <div class="error-content">
                            <h4>Mermaid Syntax Errors Detected</h4>
                            <div class="error-details">
                                ${criticalErrors.slice(0, 5).map(error => `<div class="error-line">• ${error}</div>`).join('')}
                                ${criticalErrors.length > 5 ? `<div class="error-line">• ... and ${criticalErrors.length - 5} more</div>` : ''}
                            </div>
                            <div class="error-suggestions">
                                <p><strong>Suggestions:</strong></p>
                                <ul>
                                    <li>Remove trailing commas from classDef statements</li>
                                    <li>Ensure proper line breaks between classDef definitions</li>
                                    <li>Check that all referenced nodes are defined</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                `;
                return; // Skip rendering for critical syntax errors
            }
        }

        // Show loading state
        container.innerHTML = `
            <div class="mermaid-loading">
                <div class="spinner"></div>
                <p>Rendering diagram...</p>
            </div>
        `;

        // Pre-render syntax check for common issues
        const syntaxCheck = preRenderSyntaxCheck(diagramCode);
        if (!syntaxCheck.valid) {
            container.innerHTML = `
                <div class="mermaid-error">
                    <div class="error-icon">⚠️</div>
                    <div class="error-content">
                        <h4>Syntax Issues Detected</h4>
                        <div class="error-details">
                            ${syntaxCheck.errors.map(error => `<div class="error-line">• ${error}</div>`).join('')}
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // Render with Mermaid
        const result = await mermaid.render(`${containerId}-svg-${Date.now()}`, diagramCode);

        // Create enhanced container with controls
        const enhancedContainer = document.createElement('div');
        enhancedContainer.className = 'mermaid-enhanced-container';
        enhancedContainer.innerHTML = `
            <div class="mermaid-svg-container">
                ${result.svg}
            </div>
            <div class="mermaid-controls">
                <button class="mermaid-btn zoom-in" onclick="zoomDiagram('${containerId}', 1.2)" title="Zoom In">
                    <i class="fas fa-search-plus"></i>
                </button>
                <button class="mermaid-btn zoom-out" onclick="zoomDiagram('${containerId}', 0.8)" title="Zoom Out">
                    <i class="fas fa-search-minus"></i>
                </button>
                <button class="mermaid-btn reset-zoom" onclick="resetDiagramZoom('${containerId}')" title="Reset Zoom">
                    <i class="fas fa-compress"></i>
                </button>
                <button class="mermaid-btn download" onclick="downloadDiagram('${containerId}', '${diagramCode.replace(/'/g, "\\'")}')" title="Download Diagram">
                    <i class="fas fa-download"></i>
                </button>
                <button class="mermaid-btn fullscreen" onclick="toggleFullscreen('${containerId}')" title="Toggle Fullscreen">
                    <i class="fas fa-expand"></i>
                </button>
            </div>
            ${validation.warnings.length > 0 ? `
                <div class="mermaid-warnings">
                    <h4><i class="fas fa-exclamation-triangle"></i> Diagram Warnings</h4>
                    <ul>
                        ${validation.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        `;

        container.innerHTML = '';
        container.appendChild(enhancedContainer);

        // Add zoom and pan functionality
        addDiagramInteractivity(container);

        // Store diagram code for operations
        container.dataset.diagramCode = diagramCode;

        // Show warnings if any
        if (validation.warnings && validation.warnings.length > 0) {
            const warningsContainer = document.createElement('div');
            warningsContainer.className = 'mermaid-warnings';
            warningsContainer.innerHTML = `
                <div class="warnings-header">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${validation.warnings.length} Warning${validation.warnings.length > 1 ? 's' : ''}</span>
                    <button class="toggle-warnings" onclick="toggleElement(this.nextElementSibling)">
                        <i class="fas fa-chevron-down"></i> Show Details
                    </button>
                </div>
                <div class="warnings-content" style="display: none;">
                    <ul>
                        ${validation.warnings.map(warning => `<li>${warning}</li>`).join('')}
                    </ul>
                </div>
            `;
            container.appendChild(warningsContainer);
        }

    } catch (error) {
        console.error(`Mermaid rendering error for ${containerId}:`, error);

        // Show error with detailed information and recovery options
        container.innerHTML = `
            <div class="mermaid-error-container">
                <div class="mermaid-error-header">
                    <h4><i class="fas fa-exclamation-triangle"></i> Diagram Rendering Error</h4>
                    <button class="mermaid-btn retry" onclick="retryDiagramRendering('${containerId}')">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </div>
                <div class="mermaid-error-content">
                    <p><strong>Error:</strong> ${error.message}</p>
                    <details>
                        <summary>View Diagram Code</summary>
                        <pre><code>${escapeHtml(diagramCode)}</code></pre>
                    </details>
                    <details>
                        <summary>Troubleshooting Tips</summary>
                        <ul>
                            <li>Check for unmatched brackets: <code>[ ]</code>, <code>( )</code>, <code>{ }</code></li>
                            <li>Ensure all node IDs are alphanumeric with underscores</li>
                            <li>Verify arrow syntax: <code>--></code>, <code>-.-></code>, <code>==></code></li>
                            <li>Check subgraph syntax: <code>subgraph name[content] end</code></li>
                        </ul>
                    </details>
                </div>
            </div>
        `;
    }
}

/**
 * Validate Mermaid diagram syntax with detailed error reporting
 */
function validateMermaidSyntax(diagramCode) {
    const warnings = [];
    const lines = diagramCode.split('\n');

    // Track various elements for validation
    let subgraphStack = [];
    let nodeIds = new Set();

    lines.forEach((line, index) => {
        const lineNum = index + 1;
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('%%')) {
            return;
        }

        // Check for graph type declaration
        if (trimmed.startsWith(('graph ', 'flowchart ', 'sequenceDiagram', 'gantt', 'pie'))) {
            if (trimmed.includes('-->') && trimmed.includes('graph') && !trimmed.includes('TD') && !trimmed.includes('LR')) {
                warnings.push(`Line ${lineNum}: Graph direction might be unclear`);
            }
            return;
        }

        // Check for subgraph syntax
        if (trimmed.startsWith('subgraph ')) {
            const subgraphMatch = trimmed.match(/subgraph\s+([^[]+)(\[.*\])?/);
            if (subgraphMatch) {
                const name = subgraphMatch[1].trim();
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
                    warnings.push(`Line ${lineNum}: Subgraph name contains invalid characters`);
                }
            }
            subgraphStack.push(lineNum);
            return;
        } else if (trimmed === 'end') {
            if (subgraphStack.length > 0) {
                subgraphStack.pop();
            } else {
                warnings.push(`Line ${lineNum}: 'end' without matching 'subgraph'`);
            }
            return;
        }

        // Check for node definitions and validate IDs
        const nodePatterns = [
            /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.*?)\]/,  // node[Label]
            /^([a-zA-Z_][a-zA-Z0-9_]*)\((.*?)\)/,  // node(Label)
            /^([a-zA-Z_][a-zA-Z0-9_]*)\{(.*?)\}/   // node{Label}
        ];

        for (const pattern of nodePatterns) {
            const match = trimmed.match(pattern);
            if (match) {
                const nodeId = match[1];
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nodeId)) {
                    warnings.push(`Line ${lineNum}: Node ID '${nodeId}' contains invalid characters`);
                }

                if (nodeIds.has(nodeId)) {
                    warnings.push(`Line ${lineNum}: Duplicate node ID '${nodeId}'`);
                }
                nodeIds.add(nodeId);
                break;
            }
        }

        // Enhanced arrow syntax validation with better node ID handling
        const arrowMatch = trimmed.match(/([^-\s]*)\s*-{1,3}>\s*(.+)$/);
        if (arrowMatch) {
            const leftSide = arrowMatch[1].trim();
            const rightSide = arrowMatch[2].trim();

            // Enhanced left side validation - check for exact match or partial match
            let leftNodeFound = false;
            if (nodeIds.has(leftSide)) {
                leftNodeFound = true;
            } else {
                // Check if any node ID starts with this prefix (handles numbered variants)
                for (const nodeId of nodeIds) {
                    if (nodeId.startsWith(leftSide) && (nodeId === leftSide || nodeId.match(new RegExp(`^${leftSide}_\\d+$`)))) {
                        leftNodeFound = true;
                        break;
                    }
                }
            }

            if (!leftNodeFound) {
                warnings.push(`Line ${lineNum}: Undefined source node '${leftSide}'. Available nodes: ${Array.from(nodeIds).slice(0, 5).join(', ')}${nodeIds.size > 5 ? '...' : ''}`);
            }

            // Enhanced right side validation
            const rightNodeId = rightSide.split(/\s+/)[0];
            if (rightNodeId && !rightNodeId.startsWith('"')) {
                let rightNodeFound = false;

                if (nodeIds.has(rightNodeId)) {
                    rightNodeFound = true;
                } else {
                    // Check for numbered variants and partial matches
                    for (const nodeId of nodeIds) {
                        if (nodeId.startsWith(rightNodeId) && (nodeId === rightNodeId || nodeId.match(new RegExp(`^${rightNodeId}_\\d+$`)))) {
                            rightNodeFound = true;
                            break;
                        }
                    }
                }

                if (!rightNodeFound && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rightNodeId)) {
                    // Only report as error if it looks like a valid ID format but wasn't found
                    if (/^[a-zA-Z_]/.test(rightNodeId)) {
                        warnings.push(`Line ${lineNum}: Undefined target node '${rightNodeId}'. Available nodes: ${Array.from(nodeIds).slice(0, 5).join(', ')}${nodeIds.size > 5 ? '...' : ''}`);
                    }
                }
            }
        }

        // Check for bracket balance
        const openBrackets = (trimmed.match(/\[/g) || []).length;
        const closeBrackets = (trimmed.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) {
            warnings.push(`Line ${lineNum}: Unmatched brackets`);
        }

        const openParens = (trimmed.match(/\(/g) || []).length;
        const closeParens = (trimmed.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            warnings.push(`Line ${lineNum}: Unmatched parentheses`);
        }

        const openBraces = (trimmed.match(/\{/g) || []).length;
        const closeBraces = (trimmed.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
            warnings.push(`Line ${lineNum}: Unmatched braces`);
        }

        // Enhanced trailing comma detection for classDef statements
        if (trimmed.startsWith('classDef ')) {
            // Look for trailing commas at the end of classDef properties
            const classDefMatch = trimmed.match(/classDef\s+\w+\s+(.+)$/);
            if (classDefMatch) {
                const properties = classDefMatch[1];

                // Check if properties end with comma
                if (properties.endsWith(',')) {
                    const fixedLine = trimmed.slice(0, -1); // Remove trailing comma
                    warnings.push(`Line ${lineNum}: classDef statement has trailing comma - remove the comma at the end`);
                    warnings.push(`  Current:  ${trimmed}`);
                    warnings.push(`  Fix:      ${fixedLine}`);
                }

                // Check for incomplete property values (common syntax errors)
                const propertyList = properties.split(',');
                let hasTrailingCommaInProperties = false;

                propertyList.forEach((prop, index) => {
                    const trimmedProp = prop.trim();

                    if (trimmedProp && !trimmedProp.includes(':')) {
                        warnings.push(`Line ${lineNum}: Incomplete property '${trimmedProp}' in classDef - missing value after colon`);
                    }

                    // Enhanced stroke-width syntax validation
                    if (trimmedProp.includes('stroke-width:')) {
                        if (trimmedProp.endsWith(',')) {
                            hasTrailingCommaInProperties = true;
                            warnings.push(`Line ${lineNum}: stroke-width property has trailing comma - this causes parse errors`);
                            warnings.push(`  Current:  ${trimmedProp}`);
                            warnings.push(`  Fix:      ${trimmedProp.slice(0, -1)}`);
                        }

                        // Validate stroke-width value format
                        const strokeWidthMatch = trimmedProp.match(/stroke-width:\s*(\d+(?:\.\d+)?)(px)?/);
                        if (!strokeWidthMatch) {
                            warnings.push(`Line ${lineNum}: Invalid stroke-width format - should be 'stroke-width:2px' or 'stroke-width:2'`);
                        }
                    }

                    // Validate color formats
                    if (trimmedProp.includes('fill:') || trimmedProp.includes('stroke:')) {
                        const colorMatch = trimmedProp.match(/(?:fill|stroke):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-zA-Z]+)/);
                        if (!colorMatch) {
                            warnings.push(`Line ${lineNum}: Invalid color format in '${trimmedProp}' - use hex (#ff0000) or named colors (red)`);
                        }
                    }
                });

                // Suggest complete fix if multiple issues found
                if (hasTrailingCommaInProperties || properties.endsWith(',')) {
                    const fixedProperties = properties.replace(/,\s*$/, '');
                    const fixedLine = trimmed.slice(0, trimmed.lastIndexOf(properties)) + fixedProperties;
                    warnings.push(`Line ${lineNum}: Suggested complete fix:`);
                    warnings.push(`  Fixed:    ${fixedLine}`);
                }
            }
        }
    });

    if (subgraphStack.length > 0) {
        warnings.push(`Unclosed subgraph(s) starting at lines: ${subgraphStack.join(', ')}`);
    }

    return {
        isValid: warnings.length === 0,
        warnings: warnings
    };
}

/**
 * Get enhanced Mermaid diagram validation with full details
 */
function getMermaidValidation(diagramCode) {
    return validateMermaidSyntax(diagramCode);
}

/**
 * Add interactive zoom and pan functionality to diagram
 */
function addDiagramInteractivity(container) {
    const svgContainer = container.querySelector('.mermaid-svg-container');
    const svg = svgContainer?.querySelector('svg');

    if (!svg) return;

    let currentZoom = 1;
    let isPanning = false;
    let startX, startY;
    let scrollLeft, scrollTop;

    // Store original transform
    svg.dataset.originalTransform = svg.style.transform || '';

    container.dataset.currentZoom = currentZoom;

    // Pan functionality
    svg.addEventListener('mousedown', (e) => {
        if (e.shiftKey || e.button === 1) { // Shift+click or middle mouse button
            isPanning = true;
            startX = e.pageX - svgContainer.offsetLeft;
            startY = e.pageY - svgContainer.offsetTop;
            scrollLeft = svgContainer.scrollLeft;
            scrollTop = svgContainer.scrollTop;
            svg.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    svg.addEventListener('mouseleave', () => {
        isPanning = false;
        svg.style.cursor = 'grab';
    });

    svg.addEventListener('mouseup', () => {
        isPanning = false;
        svg.style.cursor = 'grab';
    });

    svg.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();

        const x = e.pageX - svgContainer.offsetLeft;
        const y = e.pageY - svgContainer.offsetTop;
        const walkX = (x - startX) * 2;
        const walkY = (y - startY) * 2;

        svgContainer.scrollLeft = scrollLeft - walkX;
        svgContainer.scrollTop = scrollTop - walkY;
    });

    // Wheel zoom
    svgContainer.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();

            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.5, Math.min(3, currentZoom * delta));

            zoomDiagram(container.id, newZoom / currentZoom);
        }
    });

    // Touch support for mobile devices
    let touchStartDistance = 0;
    let touchStartZoom = 1;

    svg.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch to zoom
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDistance = Math.sqrt(dx * dx + dy * dy);
            touchStartZoom = currentZoom;
        } else if (e.touches.length === 1) {
            // Single touch for panning
            isPanning = true;
            startX = e.touches[0].clientX - svgContainer.offsetLeft;
            startY = e.touches[0].clientY - svgContainer.offsetTop;
            scrollLeft = svgContainer.scrollLeft;
            scrollTop = svgContainer.scrollTop;
        }
    });

    svg.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            // Pinch to zoom
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (touchStartDistance > 0) {
                const scale = distance / touchStartDistance;
                const newZoom = Math.max(0.5, Math.min(3, touchStartZoom * scale));
                zoomDiagram(container.id, newZoom / currentZoom);
            }
        } else if (e.touches.length === 1 && isPanning) {
            // Single touch panning
            e.preventDefault();
            const x = e.touches[0].clientX - svgContainer.offsetLeft;
            const y = e.touches[0].clientY - svgContainer.offsetTop;
            const walkX = (x - startX) * 2;
            const walkY = (y - startY) * 2;

            svgContainer.scrollLeft = scrollLeft - walkX;
            svgContainer.scrollTop = scrollTop - walkY;
        }
    });

    svg.addEventListener('touchend', () => {
        isPanning = false;
        touchStartDistance = 0;
    });

    // Set cursor style
    svg.style.cursor = 'grab';
}

/**
 * Zoom diagram by specified factor
 */
function zoomDiagram(containerId, factor) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const currentZoom = parseFloat(container.dataset.currentZoom || '1');
    const newZoom = Math.max(0.5, Math.min(3, currentZoom * factor));

    const g = svg.querySelector('g');
    if (g) {
        const transform = svg.dataset.originalTransform || '';
        g.style.transform = `${transform} scale(${newZoom})`;
        g.style.transformOrigin = 'center center';
    }

    container.dataset.currentZoom = newZoom;
}

/**
 * Reset diagram zoom to default
 */
function resetDiagramZoom(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    const g = svg.querySelector('g');
    if (g) {
        g.style.transform = svg.dataset.originalTransform || '';
        g.style.transformOrigin = '';
    }

    container.dataset.currentZoom = 1;

    // Reset scroll position
    const svgContainer = container.querySelector('.mermaid-svg-container');
    if (svgContainer) {
        svgContainer.scrollLeft = 0;
        svgContainer.scrollTop = 0;
    }
}

/**
 * Retry diagram rendering
 */
function retryDiagramRendering(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const diagramCode = container.dataset.diagramCode;
    if (diagramCode) {
        renderEnhancedMermaidDiagram(containerId, diagramCode);
    }
}

/**
 * Download diagram as SVG
 */
function downloadDiagram(containerId, format = 'svg') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    switch (format.toLowerCase()) {
        case 'svg':
            downloadDiagramAsSVG(container, svg);
            break;
        case 'png':
            downloadDiagramAsPNG(container, svg);
            break;
        case 'pdf':
            downloadDiagramAsPDF(container, svg);
            break;
        default:
            downloadDiagramAsSVG(container, svg);
    }
}

/**
 * Download diagram as SVG file
 */
function downloadDiagramAsSVG(container, svg) {
    const containerId = container.id || 'diagram';

    // Serialize SVG to string
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svg);

    // Add XML declaration if missing
    if (!svgString.startsWith('<?xml')) {
        svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
    }

    // Create blob and download
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${containerId}-diagram.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Download diagram as PNG file
 */
function downloadDiagramAsPNG(container, svg) {
    const containerId = container.id || 'diagram';

    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Get SVG dimensions
    const svgRect = svg.getBoundingClientRect();
    canvas.width = svgRect.width * 2; // Higher resolution
    canvas.height = svgRect.height * 2;
    canvas.style.width = svgRect.width + 'px';
    canvas.style.height = svgRect.height + 'px';

    // Scale for high resolution
    ctx.scale(2, 2);

    // Convert SVG to data URL
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = function() {
        // White background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw image
        ctx.drawImage(img, 0, 0);

        // Convert to blob and download
        canvas.toBlob(function(blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${containerId}-diagram.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            URL.revokeObjectURL(svgUrl);
        }, 'image/png');
    };

    img.src = svgUrl;
}

/**
 * Download diagram as PDF file
 */
function downloadDiagramAsPDF(container, svg) {
    const containerId = container.id || 'diagram';

    // Use jsPDF library if available, otherwise fallback to SVG
    if (typeof window.jsPDF !== 'undefined') {
        try {
            const svgData = new XMLSerializer().serializeToString(svg);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Get SVG dimensions
            const svgRect = svg.getBoundingClientRect();
            canvas.width = svgRect.width;
            canvas.height = svgRect.height;

            const img = new Image();
            img.onload = function() {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);

                const imgData = canvas.toDataURL('image/png');
                const pdf = new window.jsPDF({
                    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
                    unit: 'px',
                    format: [canvas.width, canvas.height]
                });

                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save(`${containerId}-diagram.pdf`);
            };

            img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('PDF export requires jsPDF library. Downloading SVG instead.');
            downloadDiagramAsSVG(container, svg);
        }
    } else {
        // Fallback to SVG if jsPDF is not available
        alert('PDF export requires jsPDF library. Downloading SVG instead.');
        downloadDiagramAsSVG(container, svg);
    }
}

/**
 * Toggle fullscreen mode for diagram
 */
function toggleFullscreen(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const enhancedContainer = container.querySelector('.mermaid-enhanced-container');
    if (!enhancedContainer) return;

    if (!document.fullscreenElement) {
        enhancedContainer.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

/**
 * Escape HTML characters for safe display
 */
function addMermaidControls(container) {
    /**
     * Add interactive controls to a Mermaid diagram container.
     * Compatibility method for enhanced diagram integration.
     */
    if (!container) {
        console.warn('Container not provided for Mermaid controls');
        return;
    }

    // Check if controls already exist
    const existingControls = container.querySelector('.mermaid-controls');
    if (existingControls) {
        return;
    }

    // Create controls container
    const controls = document.createElement('div');
    controls.className = 'mermaid-controls';
    controls.innerHTML = `
        <button class="mermaid-btn zoom-in" title="Zoom In (Ctrl + +)">
            <i class="fas fa-search-plus"></i>
        </button>
        <button class="mermaid-btn zoom-out" title="Zoom Out (Ctrl + -)">
            <i class="fas fa-search-minus"></i>
        </button>
        <button class="mermaid-btn zoom-reset" title="Reset Zoom (Ctrl + 0)">
            <i class="fas fa-compress"></i>
        </button>
        <button class="mermaid-btn fullscreen" title="Fullscreen (F)">
            <i class="fas fa-expand"></i>
        </button>
        <div class="mermaid-download-group">
            <button class="mermaid-btn download" title="Download (Ctrl + S)">
                <i class="fas fa-download"></i>
            </button>
            <div class="mermaid-download-menu">
                <button class="download-option" data-format="svg">
                    <i class="fas fa-file-code"></i> SVG
                </button>
                <button class="download-option" data-format="png">
                    <i class="fas fa-file-image"></i> PNG
                </button>
                <button class="download-option" data-format="pdf">
                    <i class="fas fa-file-pdf"></i> PDF
                </button>
            </div>
        </div>
    `;

    // Add controls to container
    container.appendChild(controls);

    // Add event listeners
    controls.querySelector('.zoom-in').addEventListener('click', () => {
        zoomDiagram(container, 1.2);
    });

    controls.querySelector('.zoom-out').addEventListener('click', () => {
        zoomDiagram(container, 0.8);
    });

    controls.querySelector('.zoom-reset').addEventListener('click', () => {
        resetDiagramZoom(container);
    });

    controls.querySelector('.fullscreen').addEventListener('click', () => {
        toggleFullscreen(container);
    });

    // Enhanced download functionality
    const downloadBtn = controls.querySelector('.download');
    const downloadMenu = controls.querySelector('.mermaid-download-menu');

    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadMenu.classList.toggle('show');
    });

    // Add download format options
    downloadMenu.querySelectorAll('.download-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const format = option.dataset.format;
            downloadDiagram(container.id, format);
            downloadMenu.classList.remove('show');
        });
    });

    // Close download menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!downloadBtn.contains(e.target) && !downloadMenu.contains(e.target)) {
            downloadMenu.classList.remove('show');
        }
    });

    // Add keyboard shortcuts
    addKeyboardShortcuts(container);
}

/**
 * Add keyboard shortcuts for diagram interaction
 */
function addKeyboardShortcuts(container) {
    const containerId = container.id || 'diagram';

    const keydownHandler = (e) => {
        // Only handle shortcuts when diagram is in focus or visible
        if (!container.offsetParent) return;

        // Zoom shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case '+':
                case '=':
                    e.preventDefault();
                    zoomDiagram(containerId, 1.2);
                    break;
                case '-':
                case '_':
                    e.preventDefault();
                    zoomDiagram(containerId, 0.8);
                    break;
                case '0':
                    e.preventDefault();
                    resetDiagramZoom(containerId);
                    break;
                case 's':
                    e.preventDefault();
                    // Quick download as SVG
                    downloadDiagram(containerId, 'svg');
                    break;
            }
        }

        // Fullscreen shortcut
        if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            toggleFullscreen(containerId);
        }

        // Reset with Escape
        if (e.key === 'Escape') {
            resetDiagramZoom(containerId);
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
        }

        // Pan with arrow keys when holding Shift
        if (e.shiftKey) {
            const svgContainer = container.querySelector('.mermaid-svg-container');
            if (svgContainer) {
                const scrollAmount = 50;
                switch(e.key) {
                    case 'ArrowUp':
                        e.preventDefault();
                        svgContainer.scrollTop -= scrollAmount;
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        svgContainer.scrollTop += scrollAmount;
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        svgContainer.scrollLeft -= scrollAmount;
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        svgContainer.scrollLeft += scrollAmount;
                        break;
                }
            }
        }
    };

    // Add keyboard event listener
    document.addEventListener('keydown', keydownHandler);

    // Store reference for cleanup
    container._keydownHandler = keydownHandler;
}

function enhanced_mermaid_diagram(containerId, diagramCode) {
    /**
     * Enhanced Mermaid diagram rendering with full feature support.
     * Compatibility method for enhanced diagram integration.
     */
    return renderEnhancedMermaidDiagram(containerId, diagramCode);
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Enhanced Mermaid Preview Functionality
function showMermaidPreview(diagramName) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'mermaidPreviewModal';
    modal.innerHTML = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="fas fa-project-diagram"></i>
                        ${diagramName.replace('_', ' ').toUpperCase()} Diagram
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-12">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <h6>Interactive Diagram Preview</h6>
                                <div class="btn-group" role="group">
                                    <button type="button" class="btn btn-sm btn-outline-primary" onclick="zoomMermaidDiagram('in')">
                                        <i class="fas fa-search-plus"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-primary" onclick="zoomMermaidDiagram('out')">
                                        <i class="fas fa-search-minus"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-primary" onclick="zoomMermaidDiagram('reset')">
                                        <i class="fas fa-compress"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-success" onclick="downloadMermaidDiagram('${diagramName}')">
                                        <i class="fas fa-download"></i> Download
                                    </button>
                                </div>
                            </div>
                            <div class="mermaid-preview-container" id="mermaidPreviewContainer">
                                <div class="mermaid-loading">
                                    <div class="spinner"></div>
                                    <p>Loading interactive diagram...</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="row mt-4">
                        <div class="col-md-6">
                            <h6>Diagram Statistics</h6>
                            <div id="diagramStats" class="diagram-stats">
                                <div class="stat-item">
                                    <span class="stat-label">Nodes:</span>
                                    <span class="stat-value" id="nodeCount">-</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Connections:</span>
                                    <span class="stat-value" id="connectionCount">-</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Complexity:</span>
                                    <span class="stat-value" id="complexityLevel">-</span>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <h6>Export Options</h6>
                            <div class="export-options">
                                <button type="button" class="btn btn-sm btn-outline-secondary me-2" onclick="exportMermaidAsSvg('${diagramName}')">
                                    <i class="fas fa-file-image"></i> Export as SVG
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary me-2" onclick="exportMermaidAsPng('${diagramName}')">
                                    <i class="fas fa-file-image"></i> Export as PNG
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="copyMermaidCode('${diagramName}')">
                                    <i class="fas fa-copy"></i> Copy Code
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="row mt-3">
                        <div class="col-12">
                            <h6>Mermaid Source Code</h6>
                            <div class="code-container">
                                <button type="button" class="btn btn-sm btn-outline-primary copy-btn" onclick="copyMermaidCode('${diagramName}')">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <pre><code id="mermaidSourceCode" class="language-mermaid"></code></pre>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary" onclick="refreshMermaidPreview('${diagramName}')">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const diagramCode = getDiagramCode(diagramName);
    if (diagramCode) {
        setTimeout(() => {
            renderMermaidPreview(diagramName, diagramCode);
        }, 100);
    }

    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modal);
    });
}

function getDiagramCode(diagramName) {
    if (window.generatedDiagrams && window.generatedDiagrams[diagramName]) {
        return window.generatedDiagrams[diagramName];
    }

    const previewElement = document.querySelector(`[data-diagram="${diagramName}"]`);
    if (previewElement) {
        const codeBlock = previewElement.querySelector('code');
        if (codeBlock) {
            return codeBlock.textContent;
        }
    }

    return null;
}

function renderMermaidPreview(diagramName, diagramCode) {
    const container = document.getElementById('mermaidPreviewContainer');
    const sourceCodeElement = document.getElementById('mermaidSourceCode');

    if (!container || !diagramCode) return;

    if (sourceCodeElement) {
        sourceCodeElement.textContent = diagramCode;
    }

    updateDiagramStatistics(diagramCode);

    const diagramContainerId = `mermaid-preview-${diagramName}`;
    container.innerHTML = `<div id="${diagramContainerId}" class="mermaid"></div>`;

    renderEnhancedMermaidDiagram(diagramContainerId, diagramCode);
}

function updateDiagramStatistics(diagramCode) {
    const lines = diagramCode.split('\n');
    const nodePattern = /(\w+)\[|[^\]]+\]|\w+/g;
    const connectionPattern = /-->|--|<-|\.\./g;

    const nodes = diagramCode.match(nodePattern) || [];
    const connections = diagramCode.match(connectionPattern) || [];

    document.getElementById('nodeCount').textContent = nodes.length;
    document.getElementById('connectionCount').textContent = connections.length;

    const complexityLevel = nodes.length > 20 ? 'High' : nodes.length > 10 ? 'Medium' : 'Low';
    document.getElementById('complexityLevel').textContent = complexityLevel;
}

function zoomMermaidDiagram(direction) {
    const container = document.querySelector('#mermaidPreviewContainer .mermaid');
    if (!container) return;

    const currentScale = parseFloat(container.style.transform.replace('scale(', '').replace(')', '') || 1);
    let newScale;

    switch (direction) {
        case 'in':
            newScale = Math.min(currentScale + 0.1, 2);
            break;
        case 'out':
            newScale = Math.max(currentScale - 0.1, 0.5);
            break;
        case 'reset':
            newScale = 1;
            break;
        default:
            return;
    }

    container.style.transform = `scale(${newScale})`;
    container.style.transformOrigin = 'center top';
    container.style.transition = 'transform 0.2s ease';
}

function downloadMermaidDiagram(diagramName) {
    const svgElement = document.querySelector('#mermaidPreviewContainer svg');
    if (!svgElement) {
        showNotification('No diagram to download', 'error');
        return;
    }

    svgToPng(svgElement, `${diagramName}-diagram.png`)
        .then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${diagramName}-diagram.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showNotification('Diagram downloaded successfully', 'success');
        })
        .catch(error => {
            console.error('Error downloading diagram:', error);
            showNotification('Error downloading diagram', 'error');
        });
}

function exportMermaidAsSvg(diagramName) {
    const svgElement = document.querySelector('#mermaidPreviewContainer svg');
    if (!svgElement) {
        showNotification('No diagram to export', 'error');
        return;
    }

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagramName}-diagram.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('SVG exported successfully', 'success');
}

function exportMermaidAsPng(diagramName) {
    downloadMermaidDiagram(diagramName);
}

function copyMermaidCode(diagramName) {
    const diagramCode = getDiagramCode(diagramName);
    if (!diagramCode) {
        showNotification('No diagram code to copy', 'error');
        return;
    }

    navigator.clipboard.writeText(diagramCode)
        .then(() => {
            showNotification('Mermaid code copied to clipboard', 'success');
        })
        .catch(error => {
            console.error('Error copying to clipboard:', error);
            showNotification('Error copying to clipboard', 'error');
        });
}

function refreshMermaidPreview(diagramName) {
    const diagramCode = getDiagramCode(diagramName);
    if (diagramCode) {
        renderMermaidPreview(diagramName, diagramCode);
        showNotification('Diagram refreshed', 'success');
    }
}

function svgToPng(svgElement, fileName) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const svgRect = svgElement.getBoundingClientRect();
        canvas.width = svgRect.width * 2;
        canvas.height = svgRect.height * 2;

        ctx.scale(2, 2);

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const img = new Image();

        img.onload = function() {
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(function(blob) {
                resolve(blob);
            }, 'image/png');
        };

        img.onerror = function() {
            reject(new Error('Failed to load SVG for conversion'));
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    });
}

window.generatedDiagrams = window.generatedDiagrams || {};

function storeDiagramForPreview(diagramName, diagramCode) {
    window.generatedDiagrams[diagramName] = diagramCode;
}
