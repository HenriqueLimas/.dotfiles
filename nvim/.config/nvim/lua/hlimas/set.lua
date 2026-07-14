vim.opt.nu = true
vim.opt.relativenumber = true

vim.opt.tabstop = 4
vim.opt.softtabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

vim.opt.smartindent = true

vim.opt.wrap = false

vim.opt.swapfile = false
vim.opt.backup = false
vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.opt.undofile = true

vim.opt.hlsearch = false
vim.opt.incsearch = true

vim.opt.termguicolors = true

vim.opt.scrolloff = 8
vim.opt.signcolumn = "yes"
vim.opt.isfname:append("@-@")

vim.opt.updatetime = 50

vim.opt.colorcolumn = "120"

-- Netrw configuration
-- Auto-select the current file when opening netrw
vim.g.netrw_fastbrowse = 0

-- Capture the filename before netrw takes over the current buffer
local _netrw_origin_file = ""
vim.api.nvim_create_autocmd("BufLeave", {
	callback = function(ev)
		if vim.bo[ev.buf].filetype ~= "netrw" then
			_netrw_origin_file = vim.fn.expand("%:t")
		end
	end,
})

-- Position cursor on current file in netrw
vim.api.nvim_create_autocmd("FileType", {
	pattern = "netrw",
	callback = function()
		local file_name = _netrw_origin_file
		vim.defer_fn(function()
			if file_name ~= "" then
				vim.fn.search("\\V" .. vim.fn.escape(file_name, "\\"))
			end
		end, 10)
	end,
})
