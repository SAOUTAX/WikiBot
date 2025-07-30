const { mw } = require('./utils/mediaWiki');
const config = require('./utils/config');

class DeleteUnused {
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
            'Category:To',
            'Category:With',
            'Category:In',
        ];
        this.daysBefore = 3;
    }

    isFileOldEnough(timestamp) {
        const fileDate = new Date(timestamp);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.daysBefore);
        return fileDate < cutoffDate;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getCategoryFiles(categoryTitle) {
        const files = [];
        let cmcontinue = '';
        
        while (cmcontinue !== undefined) {
            try {
                const res = await this.api.post({
                    action: 'query',
                    list: 'categorymembers',
                    cmtitle: categoryTitle,
                    cmnamespace: 6,
                    cmprop: ['title', 'timestamp'],
                    cmsort: 'timestamp',
                    cmdir: 'desc',
                    cmlimit: 'max',
                    ...(cmcontinue ? { cmcontinue } : {})
                });

                if (!res?.query?.categorymembers) break;

                cmcontinue = res.continue?.cmcontinue;
                files.push(...res.query.categorymembers.map(member => ({
                    title: member.title,
                    timestamp: member.timestamp
                })));
            } catch (err) {
                console.error(`获取分类失败 (${categoryTitle}):`, err);
                break;
            }
        }
        
        return files;
    }

    async getAllCategoryFiles() {
        const allFiles = [];
        
        for (const category of this.targetCategories) {
            const categoryFiles = await this.getCategoryFiles(category);
            allFiles.push(...categoryFiles);
            await this.sleep(1000);
        }

        const uniqueFiles = [];
        const seenTitles = new Set();
        
        for (const file of allFiles) {
            if (!seenTitles.has(file.title) && this.isFileOldEnough(file.timestamp)) {
                seenTitles.add(file.title);
                uniqueFiles.push(file);
            }
        }

        return uniqueFiles;
    }

    chunk(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    async checkGlobalUsage(fileList) {
        const queryLimit = 500;
        const fileChunks = this.chunk(fileList, queryLimit);
        const unusedFiles = [];

        for (const chunk of fileChunks) {
            const chunkResults = new Map();
            
            chunk.forEach(file => {
                chunkResults.set(file.title, { ...file, globalUsage: false, localUsage: false });
            });

            try {
                let gucontinue = '||';
                while (gucontinue) {
                    const res = await this.api.post({
                        action: 'query',
                        prop: 'globalusage',
                        titles: chunk.map(file => file.title),
                        gucontinue,
                        gulimit: 'max'
                    });

                    if (res?.query?.pages) {
                        for (const page of Object.values(res.query.pages)) {
                            const fileData = chunkResults.get(page.title);
                            if (fileData && page.globalusage?.length > 0) {
                                fileData.globalUsage = true;
                            }
                        }
                    }

                    gucontinue = res?.continue?.gucontinue || null;
                }

                let fucontinue = '';
                while (fucontinue !== undefined) {
                    const res = await this.api.post({
                        action: 'query',
                        prop: 'fileusage',
                        titles: chunk.map(file => file.title),
                        ...(fucontinue ? { fucontinue } : {}),
                        fulimit: 'max'
                    });

                    if (res?.query?.pages) {
                        for (const page of Object.values(res.query.pages)) {
                            const fileData = chunkResults.get(page.title);
                            if (fileData && page.fileusage?.length > 0) {
                                fileData.localUsage = true;
                            }
                        }
                    }

                    fucontinue = res?.continue?.fucontinue;
                }

                for (const fileData of chunkResults.values()) {
                    if (!fileData.globalUsage && !fileData.localUsage) {
                        unusedFiles.push(fileData);
                    }
                }

            } catch (err) {
                console.error('检查文件使用情况失败:', err);
            }

            await this.sleep(2000);
        }

        return unusedFiles;
    }

    async checkFileContent(title) {
        try {
            const res = await this.api.post({
                action: 'query',
                prop: 'revisions',
                rvprop: 'content|timestamp',
                titles: title,
                curtimestamp: 1
            });

            const page = Object.values(res?.query?.pages || {})[0];
            if (!page || page.missing !== undefined) return {};

            const rev = page.revisions?.[0];
            const hasTemplate = rev?.content?.includes('{{即将删除') || false;

            return {
                content: rev?.content,
                hasTemplate,
                timestamp: rev?.timestamp,
                curtimestamp: res.curtimestamp
            };
        } catch (err) {
            console.error(`检查文件内容失败 (${title}):`, err);
            return {};
        }
    }

    async editFilePage(title, base, start) {
        const doEdit = async () => {
            try {
                const res = await this.api.post({
                    action: 'edit',
                    title,
                    text: '<noinclude>{{即将删除|user=机娘亚衣琴|无使用或不再使用的文件}}</noinclude>',
                    summary: '自动挂删错误分类下的无使用文件',
                    tags: 'Bot',
                    bot: true,
                    minor: true,
                    basetimestamp: base,
                    starttimestamp: start,
                    token: await this.api.getToken('csrf')
                });

                if (res?.error?.code === 'badtoken') {
                    await this.api.getToken('csrf', true);
                    return await doEdit();
                }

                const result = res?.edit?.result;
                if (result === 'Success') {
                    const { nochange, oldrevid, newrevid } = res.edit;
                    if (!nochange) {
                        console.info(`Done: https://commons.moegirl.org.cn/Special:Diff/${oldrevid}/${newrevid}`);
                    }
                    return true;
                }
            } catch (err) {
                console.error(`编辑失败 (${title}):`, err);
            }
            return false;
        };
        return await doEdit();
    }

    async deleteUnusedFile(fileData) {
        const { content, hasTemplate, timestamp, curtimestamp } = await this.checkFileContent(fileData.title);
        if (!content || hasTemplate) return false;

        return await this.editFilePage(fileData.title, timestamp, curtimestamp);
    }

    async run() {
        try {
            await this.api.login();
            
            const allFiles = await this.getAllCategoryFiles();
            if (!allFiles.length) return;

            const unusedFiles = await this.checkGlobalUsage(allFiles);
            if (!unusedFiles.length) return;

            let success = 0;
            for (const fileData of unusedFiles) {
                if (await this.deleteUnusedFile(fileData)) success++;
            }

            console.log(`成功挂删 ${success}/${unusedFiles.length}`);
        } catch (err) {
            console.error('执行出错:', err);
        } finally {
            await this.api.logout().catch(() => {});
        }
    }
}

if (require.main === module) {
    new DeleteUnused().run().catch(console.error);
}

module.exports = DeleteUnused;