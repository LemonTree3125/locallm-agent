# Installing Models for LocalLM Agent

This guide explains how to install and manage AI models for use with LocalLM Agent.

## Prerequisites

- **Ollama** must be installed and running
- Download from: https://ollama.ai

## Quick Start

Open a terminal (PowerShell, CMD, or Terminal) and run:

```bash
ollama pull llama3.2
```

This downloads the Llama 3.2 model (~2GB), which is a great starting point.

## Recommended Models

### General Purpose

| Model | Size | Command | Description |
|-------|------|---------|-------------|
| **Llama 3.2** | 2GB | `ollama pull llama3.2` | Best balance of speed and quality |
| **Llama 3.2 (1B)** | 1.3GB | `ollama pull llama3.2:1b` | Fastest, good for quick tasks |
| **Llama 3.1 (8B)** | 4.7GB | `ollama pull llama3.1` | Higher quality responses |
| **Mistral** | 4.1GB | `ollama pull mistral` | Excellent instruction following |
| **Gemma 2** | 5.4GB | `ollama pull gemma2` | Google's latest open model |
| **Qwen 2.5** | 4.7GB | `ollama pull qwen2.5` | Strong multilingual support |
| **Phi-3** | 2.2GB | `ollama pull phi3` | Microsoft's compact model |

### For Coding

| Model | Size | Command | Description |
|-------|------|---------|-------------|
| **DeepSeek Coder (1.3B)** | 776MB | `ollama pull deepseek-coder:1.3b` | Lightweight code assistant |
| **DeepSeek Coder (6.7B)** | 3.8GB | `ollama pull deepseek-coder` | Better code understanding |
| **CodeLlama** | 3.8GB | `ollama pull codellama` | Meta's coding model |
| **Qwen 2.5 Coder** | 4.7GB | `ollama pull qwen2.5-coder` | Strong coding capabilities |

### For Creative Writing

| Model | Size | Command | Description |
|-------|------|---------|-------------|
| **Llama 3.1 (70B)** | 40GB | `ollama pull llama3.1:70b` | Best quality (requires 48GB+ RAM) |
| **Mixtral** | 26GB | `ollama pull mixtral` | Mixture of experts model |

## Managing Models

### List Installed Models

```bash
ollama list
```

### Get Model Information

```bash
ollama show llama3.2
```

### Remove a Model

```bash
ollama rm llama3.2
```

### Update a Model

```bash
ollama pull llama3.2
```

(Re-pulling downloads any updates)

## Hardware Requirements

### Minimum Requirements

- **CPU:** Modern multi-core processor
- **RAM:** 8GB (for small models like llama3.2:1b)
- **Storage:** 5GB+ free space

### Recommended for Best Experience

- **RAM:** 16GB+ for 7B models, 32GB+ for 13B+ models
- **GPU:** NVIDIA GPU with 8GB+ VRAM for acceleration
- **Storage:** SSD with 20GB+ free space

### GPU Support

Ollama automatically uses your GPU if available:

- **NVIDIA:** CUDA support (most cards from GTX 1000 series onwards)
- **AMD:** ROCm support (Linux only, select cards)
- **Apple Silicon:** Metal support (M1/M2/M3)

## Troubleshooting

### "Ollama Not Running"

1. Open a terminal and run: `ollama serve`
2. Or start the Ollama application from your system tray/menu

### "Model Not Found"

1. Check if model is installed: `ollama list`
2. Pull the model: `ollama pull <model-name>`

### Slow Generation

1. Use a smaller model (e.g., `llama3.2:1b` instead of `llama3.2`)
2. Close other applications to free RAM
3. Ensure GPU is being utilized (check Ollama logs)

### Out of Memory

1. Use a quantized (smaller) version: `ollama pull llama3.2:1b`
2. Close other applications
3. Consider upgrading RAM

## Custom Models

You can create custom models with specific system prompts:

1. Create a `Modelfile`:

```
FROM llama3.2
SYSTEM You are a helpful coding assistant specializing in Python.
PARAMETER temperature 0.7
```

2. Create the model:

```bash
ollama create my-python-helper -f Modelfile
```

3. Use it in LocalLM Agent by selecting "my-python-helper" from the dropdown.

## More Information

- Official Ollama Documentation: https://ollama.ai/docs
- Model Library: https://ollama.ai/library
- GitHub: https://github.com/ollama/ollama
