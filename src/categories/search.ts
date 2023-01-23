import _ from 'lodash';

import privileges from '../privileges';
import plugins from '../plugins';
import db from '../database';

type data = {
    type: string,
    query: string,
    page: number,
    uid: number,
    paginate: boolean,
    hardCap: string,
    resultsPerPage: number,
    qs: string
}
export default function (Categories) {
    Categories.search = async function (data: data) {
        const query: string = data.query || '';
        const page: number = data.page || 1;
        const uid: number = data.uid || 0;
        const paginate: boolean = data.hasOwnProperty('paginate') ? data.paginate : true;

        const startTime = process.hrtime();

        let cids = await findCids(query, data.hardCap);

        const result = await plugins.hooks.fire('filter:categories.search', {
            data: data,
            cids: cids,
            uid: uid,
        });
        cids = await privileges.categories.filterCids('find', result.cids, uid);

        const searchResult = {
            matchCount: cids.length,
            pageCount: 0,
            timing: '0',
            categories: '',
        };

        if (paginate) {
            const resultsPerPage = data.resultsPerPage || 50;
            const start = Math.max(0, page - 1) * resultsPerPage;
            const stop = start + resultsPerPage;
            searchResult.pageCount = Math.ceil(cids.length / resultsPerPage);
            cids = cids.slice(start, stop);
        }

        const childrenCids = await getChildrenCids(cids, uid);
        const uniqCids = _.uniq(cids.concat(childrenCids));
        const categoryData = await Categories.getCategories(uniqCids, uid);

        Categories.getTree(categoryData, 0);
        await Categories.getRecentTopicReplies(categoryData, uid, data.qs);
        categoryData.forEach((category) => {
            if (category && Array.isArray(category.children)) {
                category.children = category.children.slice(0, category.subCategoriesPerPage);
                category.children.forEach((child) => {
                    child.children = undefined;
                });
            }
        });

        categoryData.sort((c1, c2) => {
            if (c1.parentCid !== c2.parentCid) {
                return c1.parentCid - c2.parentCid;
            }
            return c1.order - c2.order;
        });

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        //searchResult.timing = (process.elapsedTimeSince(startTime) / 1000).toFixed(2);
        searchResult.categories = categoryData.filter(c => cids.includes(c.cid));
        return searchResult;
    };

    async function findCids(query, hardCap) {
        if (!query || String(query).length < 2) {
            return [];
        }
        const data = await db.getSortedSetScan({
            key: 'categories:name',
            match: `*${String(query).toLowerCase()}*`,
            limit: hardCap || 500,
        });
        return data.map(data => parseInt(data.split(':').pop(), 10));
    }

    async function getChildrenCids(cids, uid) {
        const childrenCids = await Promise.all(cids.map(cid => Categories.getChildrenCids(cid)));
        return await privileges.categories.filterCids('find', _.flatten(childrenCids), uid);
    }
}
