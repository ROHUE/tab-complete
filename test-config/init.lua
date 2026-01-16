-- Isolated Neovim config for testing Claude Completion LSP
-- Run with: nvim -u /path/to/this/init.lua

-- Basic options
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

-- Get the directory where this config lives
local config_dir = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h")
local server_path = config_dir .. "/../server/dist/index.js"

-- Auto-start Claude completion LSP for supported filetypes
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "python", "typescript", "javascript", "lua", "rust", "go", "java", "cpp", "c", "ruby", "php" },
  callback = function()
    vim.lsp.start({
      name = "claude-completion",
      cmd = { "node", server_path },
      root_dir = vim.fn.getcwd(),
    })
  end,
})

-- Keybinding to trigger completion manually
vim.keymap.set("i", "<C-Space>", function()
  vim.lsp.buf.completion()
end, { desc = "Trigger completion" })

print("Claude Completion LSP test config loaded")
print("Server path: " .. server_path)
print("Open a Python/JS/TS file and type to test completions")
print("Use <C-x><C-o> or <C-Space> to trigger completion")
