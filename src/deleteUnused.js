const { mw } = require('./utils/mediaWiki');
const config = require('./utils/config');

class deleteUnused {
    constructor() {
        this.api = new mw.Api(config.cm);
        
        this.targetCategories = [
            'Category:未知',
            'Category:作者:未知',
            'Category:作者:',
            'Category:A',
            'Category:And',
            'Category:Of',
            'Category:The',
        ];
        
        this.deleteTemplate = '{{即将删除|user=机娘亚衣琴|无使用或不再使用的文件}}';
        this.editSummary = '自动挂删错误分类下的无使用文件';
        this.processedFiles = [];
        this.failedFiles = [];
        this.daysBefore = 3; // 仅处理3天前上传的文件
    }

    // 检查文件是否为3天前上传
    isFileOldEnough(timestamp) {
        const fileDate = new Date(timestamp);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.daysBefore);
        
        return fileDate < cutoffDate;
    }

    // 格式化时间显示
    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getCategoryFiles(categoryTitle) {
        console.log(`正在获取分类 ${categoryTitle} 下的文件...`);
        
        const files = [];
        let cmcontinue = '';
        
        try {
            while (cmcontinue !== undefined) {
                const response = await this.api.post({
                    action: 'query',
                    list: 'categorymembers',
                    cmtitle: categoryTitle,
                    cmnamespace: 6, // 文件命名空间
                    cmprop: ['title', 'timestamp'],
                    cmsort: 'timestamp',
                    cmdir: 'desc',
                    cmlimit: 'max',
                    ...(cmcontinue ? { cmcontinue } : {})
                });

                if (!response.query || !response.query.categorymembers) {
                    break;
                }

                cmcontinue = response.continue ? response.continue.cmcontinue : undefined;
                
                const categoryFiles = response.query.categorymembers.map(member => ({
                    title: member.title,
                    timestamp: member.timestamp,
                    category: categoryTitle
                }));
                
                files.push(...categoryFiles);
            }

            console.log(`分类 ${categoryTitle} 包含 ${files.length} 个文件`);
            return files;
        } catch (error) {
            console.error(`获取分类 ${categoryTitle} 文件失败:`, error);
            return [];
        }
    }

    // 获取所有目标分类的文件
    async getAllCategoryFiles() {
        console.log('正在获取所有目标分类的文件...');
        
        const allFiles = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.daysBefore);
        console.log(`仅处理 ${this.formatDate(cutoffDate)} 之前上传的文件`);
        
        for (const category of this.targetCategories) {
            const categoryFiles = await this.getCategoryFiles(category);
            allFiles.push(...categoryFiles);
            
            // 延时
            await this.sleep(1000);
        }

        // 去重
        const uniqueFiles = [];
        const seenTitles = new Set();
        
        for (const file of allFiles) {
            if (!seenTitles.has(file.title)) {
                seenTitles.add(file.title);
                uniqueFiles.push(file);
            }
        }

        // 过滤出符合条件的文件
        const oldEnoughFiles = uniqueFiles.filter(file => {
            const isOld = this.isFileOldEnough(file.timestamp);
            if (!isOld) {
                console.log(`- 跳过最近上传的文件: ${file.title} (上传于: ${this.formatDate(file.timestamp)})`);
            }
            return isOld;
        });

        console.log(`总共找到 ${uniqueFiles.length} 个唯一文件`);
        console.log(`其中 ${oldEnoughFiles.length} 个文件符合时间条件（${this.daysBefore}天前上传）`);
        return oldEnoughFiles;
    }

    // 检查文件的全域使用情况
    async checkGlobalUsage(fileList) {
        console.log('正在检查文件的全域使用情况...');
        
        const queryLimit = 500;
        const fileChunks = this.chunk(fileList, queryLimit);
        const unusedFiles = [];

        for (let i = 0; i < fileChunks.length; i++) {
            const chunk = fileChunks[i];
            console.log(`检查第 ${i + 1}/${fileChunks.length} 批文件 (${chunk.length} 个文件)`);
            
            try {
                let gucontinue = '||';
                const chunkResults = new Map();
                
                chunk.forEach(file => {
                    chunkResults.set(file.title, {
                        ...file,
                        globalUsage: [],
                        localUsage: false
                    });
                });

                // 查询全域使用
                while (gucontinue) {
                    const response = await this.api.post({
                        action: 'query',
                        prop: 'globalusage',
                        titles: chunk.map(file => file.title),
                        gucontinue,
                        gulimit: 'max'
                    });

                    if (response.query && response.query.pages) {
                        for (const page of Object.values(response.query.pages)) {
                            const fileData = chunkResults.get(page.title);
                            if (fileData && page.globalusage) {
                                fileData.globalUsage.push(...page.globalusage);
                            }
                        }
                    }

                    gucontinue = response.continue ? response.continue.gucontinue : null;
                }

                // 查询本地使用
                let fucontinue = '';
                while (fucontinue !== undefined) {
                    const response = await this.api.post({
                        action: 'query',
                        prop: 'fileusage',
                        titles: chunk.map(file => file.title),
                        ...(fucontinue ? { fucontinue } : {}),
                        fulimit: 'max'
                    });

                    if (response.query && response.query.pages) {
                        for (const page of Object.values(response.query.pages)) {
                            const fileData = chunkResults.get(page.title);
                            if (fileData && page.fileusage && page.fileusage.length > 0) {
                                fileData.localUsage = true;
                            }
                        }
                    }

                    fucontinue = response.continue ? response.continue.fucontinue : undefined;
                }

                for (const fileData of chunkResults.values()) {
                    if (fileData.globalUsage.length === 0 && !fileData.localUsage) {
                        unusedFiles.push(fileData);
                        console.log(`无使用文件: ${fileData.title}`);
                    }
                }

            } catch (error) {
                console.error(`检查文件使用情况失败:`, error);
            }

            if (i < fileChunks.length - 1) {
                await this.sleep(2000);
            }
        }

        console.log(`发现 ${unusedFiles.length} 个无使用文件`);
        return unusedFiles;
    }

    // 检查文件是否已被挂删
    async checkFileContent(title) {
        try {
            const response = await this.api.post({
                action: 'query',
                prop: 'revisions',
                rvprop: 'content|timestamp',
                titles: title,
                curtimestamp: 1
            });

            if (!response.query || !response.query.pages) {
                return { hasTemplate: false, content: null, timestamp: null };
            }

            const page = Object.values(response.query.pages)[0];
            
            if (!page || page.missing !== undefined || !page.revisions || !page.revisions[0]) {
                return { hasTemplate: false, content: null, timestamp: null };
            }

            const content = page.revisions[0].content;
            const timestamp = page.revisions[0].timestamp;            
            const hasTemplate = content.includes('{{即将删除');

            return {
                hasTemplate,
                content,
                timestamp,
                curtimestamp: response.curtimestamp
            };
        } catch (error) {
            console.error(`检查文件内容失败 (${title}):`, error);
            return { hasTemplate: false, content: null, timestamp: null };
        }
    }

    async editFilePage(title, summary, basetimestamp, starttimestamp) {
        const edit = async () => {
            try {                
                const response = await this.api.post({
                    action: 'edit',
                    title: title,
                    text: `<noinclude>${this.deleteTemplate}</noinclude>`,
                    summary: summary,
                    tags: 'Bot',
                    bot: true,
                    minor: true,
                    basetimestamp: basetimestamp,
                    starttimestamp: starttimestamp,
                    token: await this.api.getToken('csrf')
                });

                if (response?.error?.code === 'badtoken') {
                    console.warn('badtoken');
                    await this.api.getToken('csrf', true);
                    return await edit();
                }

                if (response && response.edit) {
                    console.table(response.edit);
                    if (response.edit.result === 'Success') {
                        if (response.edit.nochange !== true) {
                            console.info(`✓ 编辑成功: ${title}`);
                            if (response.edit.newrevid) {
                                console.info(`   差异链接: https://commons.moegirl.org.cn/Special:Diff/${response.edit.oldrevid}/${response.edit.newrevid}`);
                            }
                        } else {
                            console.log(`- 页面内容无变化: ${title}`);
                        }
                        return true;
                    } else {
                        console.error(`✗ 编辑失败 (${title}):`, response.edit);
                        return false;
                    }
                } else {
                    console.error(`✗ 编辑响应异常 (${title}):`, response);
                    return false;
                }
            } catch (error) {
                console.error(`✗ 编辑文件页面失败 (${title}):`, error);
                return false;
            }
        };

        return await edit();
    }

    async processFile(fileData) {
        console.log(`\n处理文件: ${fileData.title}`);
        console.log(`所属分类: ${fileData.category}`);
        console.log(`上传时间: ${this.formatDate(fileData.timestamp)}`);
        
        if (!this.isFileOldEnough(fileData.timestamp)) {
            console.log(`✗ 文件上传时间不符合条件，跳过: ${fileData.title}`);
            this.failedFiles.push({
                title: fileData.title,
                reason: '文件上传时间不满足条件'
            });
            return false;
        }
        
        const contentInfo = await this.checkFileContent(fileData.title);
        
        if (!contentInfo.content) {
            console.log(`✗ 无法获取文件内容，跳过: ${fileData.title}`);
            this.failedFiles.push({
                title: fileData.title,
                reason: '无法获取文件内容'
            });
            return false;
        }

        if (contentInfo.hasTemplate) {
            console.log(`- 已被挂删，跳过: ${fileData.title}`);
            return false;
        }

        const success = await this.editFilePage(
            fileData.title,
            this.editSummary,
            contentInfo.timestamp,
            contentInfo.curtimestamp
        );

        if (success) {
            this.processedFiles.push(fileData);
            console.log(`✓ 已挂删文件: ${fileData.title}`);
            return true;
        } else {
            this.failedFiles.push({
                title: fileData.title,
                reason: '挂删失败'
            });
            return false;
        }
    }

    chunk(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    async run() {
        try {
            console.log(`目标分类: ${this.targetCategories.join(', ')}`);
            
            await this.api.login();
            console.log('✓ 登录成功');

            const allFiles = await this.getAllCategoryFiles();
            
            if (allFiles.length === 0) {
                console.log('没有找到任何文件需要处理');
                return;
            }

            // 检查文件使用情况
            const unusedFiles = await this.checkGlobalUsage(allFiles);
            
            if (unusedFiles.length === 0) {
                console.log('没有找到无使用的文件');
                return;
            }

            console.log(`\n=== 开始处理 ${unusedFiles.length} 个无使用文件 ===`);

            let processedCount = 0;
            let successCount = 0;

            for (const fileData of unusedFiles) {
                console.log(`\n--- 处理进度: ${processedCount + 1}/${unusedFiles.length} ---`);
                
                const success = await this.processFile(fileData);
                if (success) {
                    successCount++;
                }

                processedCount++;
            }

            console.log(`\n=== 执行完成 ===`);
            console.log(`检查的分类数: ${this.targetCategories.length}`);
            console.log(`总文件数: ${allFiles.length}`);
            console.log(`无使用文件数: ${unusedFiles.length}`);
            console.log(`成功处理: ${successCount} 个`);
            console.log(`失败: ${this.failedFiles.length} 个`);

            if (this.failedFiles.length > 0) {
                console.log('\n处理失败的文件:');
                this.failedFiles.forEach((file, index) => {
                    console.log(`${index + 1}. ${file.title} - ${file.reason}`);
                });
            }

        } catch (error) {
            console.error('脚本执行出错:', error);
        } finally {
            try {
                await this.api.logout();
                console.log('✓ 已退出登录');
            } catch (error) {
                console.error('退出登录失败:', error);
            }
        }
    }
}

if (require.main === module) {
    const cleaner = new deleteUnused();
    cleaner.run().catch(console.error);
}

module.exports = deleteUnused;