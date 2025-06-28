const { mw } = require("./utils/mediaWiki");
const api = new mw.Api(require("./utils/config").zh);

async function querySearch(srsearch) {
	try {
		const result = await api.post({
			action: "query",
			list: "search",
			srsearch,
			srnamespace: "10",
			srlimit: "max",
			srinfo: "",
			srprop: "",
		});
		
		if (!result?.query?.search) {
			console.log(`搜索 "${srsearch}" 未找到结果`);
			return [];
		}
		
		return result.query.search;
	} catch (e) {
		console.error(`搜索出错: ${srsearch}`, e);
		return [];
	}
}

async function correctNavFormat(pageIds) {
	if (!pageIds || pageIds.length === 0) {
		console.log("没有页面需要处理");
		return;
	}
	
	let result1;
	try {
		result1 = await api.post({
			action: "query",
			curtimestamp: 1,
			prop: "revisions",
			rvprop: "content|timestamp",
			pageids: pageIds.join("|"),
		});
	} catch (e) {
		console.error("获取页面内容出错:", e);
		return;
	}
	
	if (!result1?.query?.pages) {
		console.log("无法获取页面内容");
		return;
	}
	
	const pages = Object.values(result1.query.pages);
	console.log(`共${pages.length}个页面需要处理`);
	
	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		console.log(`== 第${i + 1}个页面：${page.title} ==`);
		
		if (page.missing) {
			console.log("页面不存在");
			continue;
		}
		
		if (!page.revisions || !page.revisions[0]) {
			console.log("无法获取页面内容");
			continue;
		}
		
		let originalContent = page.revisions[0].content;
		let modifiedContent = originalContent;
		let hasChanges = false;
		
		// 修正规则1: </noinclude>\n{{ navbox -> </noinclude>{{ navbox
		const beforeNavbox = modifiedContent;
		modifiedContent = modifiedContent.replace(
			/(<\/noinclude>)\s*\n\s*({{[\s]*navbox)/gi,
			'$1$2'
		);
		if (modifiedContent !== beforeNavbox) {
			hasChanges = true;
			console.log("修正了 </noinclude> 和 {{ navbox 之间的格式");
		}
		
		// 修正规则2: </noinclude>\n{{#invoke:Nav|box -> </noinclude>{{#invoke:Nav|box
		const beforeInvoke = modifiedContent;
		modifiedContent = modifiedContent.replace(
			/(<\/noinclude>)\s*\n\s*({{#invoke:Nav\|box)/gi,
			'$1$2'
		);
		if (modifiedContent !== beforeInvoke) {
			hasChanges = true;
			console.log("修正了 </noinclude> 和 {{#invoke:Nav|box 之间的格式");
		}
		
		// 修正规则3: ]]• -> ]] •
		const beforeDotAfter = modifiedContent;
		modifiedContent = modifiedContent.replace(
			/(\]\])•/g,
			'$1 •'
		);
		if (modifiedContent !== beforeDotAfter) {
			hasChanges = true;
			console.log("修正了 ]]• 格式");
		}
		
		// 修正规则4: •[[ -> • [[
		const beforeDotBefore = modifiedContent;
		modifiedContent = modifiedContent.replace(
			/•(\[\[)/g,
			'• $1'
		);
		if (modifiedContent !== beforeDotBefore) {
			hasChanges = true;
			console.log("修正了 •[[ 格式");
		}
		
		if (!hasChanges) {
			console.log("无需修改");
			continue;
		}
		
		// 执行编辑
		const edit = async () => {
			let result2;
			try {
				result2 = await api.post({
					action: "edit",
					title: page.title,
					text: modifiedContent,
					summary: `自动修复格式排版`,
					tags: "Bot",
					bot: true,
					minor: true,
					nocreate: true,
					basetimestamp: page.revisions[0].timestamp,
					starttimestamp: result1.curtimestamp,
					token: await api.getToken("csrf"),
				});
				
				if (result2?.error?.code === "badtoken") {
					console.warn("badtoken");
					await api.getToken("csrf", true);
					return await edit();
				}
			} catch (e) {
				console.error("编辑出错:", e);
				return;
			}
			
			console.table(result2.edit);
			if (result2.edit.nochange !== true) {
				console.info(
					`https://zh.moegirl.org.cn/Special:Diff/${result2.edit.oldrevid}/${result2.edit.newrevid}`
				);
			}
		};
		
		await edit();

		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}

function splitArray(array, size) {
	const result = [];
	for (let i = 0; i < array.length; i += size) {
		result.push(array.slice(i, i + size));
	}
	return result;
}

(async () => {
	console.log(`开始时间: ${new Date().toISOString()}`);
	
	try {
		await api.login();
		console.log("登录成功");
		
		const searchQueries = [
			'hastemplate:"navbox" insource:"name" insource:"navbox"',
			'insource:"invoke:nav" insource:"name"'
		];
		
		console.log("正在搜索相关模板页面...");
		
		const searchResults = await Promise.all(
			searchQueries.map(query => querySearch(query))
		);
		
		// 去重
		const allPages = searchResults.flat();
		const pageIds = [...new Set(
			allPages
				.filter(({ title }) => 
					!/Template:(?:Navbox|沙盒|Sandbox)|\/doc/.test(title)
				)
				.map(({ pageid }) => pageid)
		)];
		
		console.log(`搜索到 ${pageIds.length} 个需要处理的页面`);
		
		if (pageIds.length === 0) {
			console.log("没有找到需要处理的页面");
			return;
		}
		
		// 分批处理页面（每批500个）
		const pageIdBatches = splitArray(pageIds, 500);
		
		for (let i = 0; i < pageIdBatches.length; i++) {
			console.log(`\n=== 开始处理第${i + 1}批页面 (${pageIdBatches[i].length}个页面) ===`);
			await correctNavFormat(pageIdBatches[i]);
			console.log(`=== 完成处理第${i + 1}批页面 ===\n`);
			
			if (i < pageIdBatches.length - 1) {
				console.log("等待2秒后处理下一批...");
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}
		
		console.log("所有页面处理完成");
	} catch (error) {
		console.error("脚本执行出错:", error);
	}
	
	console.log(`结束时间: ${new Date().toISOString()}`);
})();