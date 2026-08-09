/**
 * EntityRecordEdit — view / edit / create a single entity record with a
 * schema-driven form (EntityRecordForm). One component backs three routes:
 *
 *   /admin/entities/:type/:id        → read-only view (Edit + Delete actions)
 *   /admin/entities/:type/:id/edit   → editable form (Save)
 *   /admin/entities/:type/new/edit   → create form (Save → new record)
 */
import { Title, } from '@solidjs/meta';
import { A, useLocation, useNavigate, useParams, } from '@solidjs/router';
import type { EntityRecord, EntityTypeDef, } from '@sitesurge/types';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import EntityRecordForm from '../../../components/admin/entities/EntityRecordForm';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import './EntitiesList.scss';

/** Fields the backend owns — never sent back on create/update. */
function stripMeta(values: Record<string, unknown>,): Record<string, unknown> {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = values;
    void _id;
    void _c;
    void _u;
    return rest;
}

const EntityRecordEdit: Component = () => {
    const params = useParams<{ type: string; id: string; }>();
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToast();

    const [type, setType,] = createSignal<EntityTypeDef | null>(null,);
    const [values, setValues,] = createSignal<Record<string, unknown>>({},);
    const [loading, setLoading,] = createSignal(true,);
    const [saving, setSaving,] = createSignal(false,);
    const [confirmDelete, setConfirmDelete,] = createSignal(false,);

    const isNew = () => params.id === 'new';
    const isEditing = () => isNew() || location.pathname.endsWith('/edit',);

    const load = async () => {
        setLoading(true,);
        try {
            const def = await cms.entityTypes.getOne(params.type,);
            setType(def,);
            if (isNew()) {
                // Seed defaults from the schema.
                const seed: Record<string, unknown> = {};
                for (const f of def.fields) {
                    if (f.defaultValue !== undefined) seed[f.key] = f.defaultValue;
                }
                setValues(seed,);
            } else {
                const record = await cms.entities.getOne(params.type, params.id,);
                setValues({ ...record, },);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to load record',);
        }
        setLoading(false,);
    };

    onMount(load,);

    const save = async () => {
        const def = type();
        if (!def) return;
        setSaving(true,);
        try {
            const payload = stripMeta(values(),);
            if (isNew()) {
                const created = await cms.entities.create(def.key, payload,);
                toast.success('Record created',);
                navigate(`/admin/entities/${def.key}/${created.id}`,);
            } else {
                await cms.entities.update(def.key, params.id, payload,);
                toast.success('Record saved',);
                navigate(`/admin/entities/${def.key}/${params.id}`,);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to save record',);
        }
        setSaving(false,);
    };

    const doDelete = async () => {
        const def = type();
        if (!def) return;
        try {
            await cms.entities.remove(def.key, params.id,);
            toast.success('Record deleted',);
            navigate(`/admin/entities/${def.key}`,);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete record',);
        }
        setConfirmDelete(false,);
    };

    const heading = () => {
        if (isNew()) return `New ${type()?.label || params.type}`;
        const rec = values() as EntityRecord;
        return String(rec.slug ?? rec.id ?? params.id,);
    };

    return (
        <div>
            <Title>{heading()} - Admin</Title>
            <div class="admin-header">
                <h1>
                    <A href="/admin/entities" class="table-link">Entities</A> /{' '}
                    <A href={`/admin/entities/${params.type}`} class="table-link">
                        {type()?.label || params.type}
                    </A>{' '}
                    / {heading()}
                </h1>
                <div style={{ display: 'flex', gap: '0.5rem', }}>
                    <Show when={isEditing()}>
                        <button class="btn btn--primary" onClick={save} disabled={saving() || loading()}>
                            {saving() ? 'Saving…' : 'Save'}
                        </button>
                    </Show>
                    <Show when={!isEditing() && !isNew()}>
                        <A href={`/admin/entities/${params.type}/${params.id}/edit`} class="btn btn--primary">
                            Edit
                        </A>
                        <button class="btn btn--danger" onClick={() => setConfirmDelete(true,)}>Delete</button>
                    </Show>
                </div>
            </div>

            <Show when={!loading() && type()} fallback={<div class="empty-state">Loading…</div>}>
                <EntityRecordForm
                    type={type()!}
                    values={values()}
                    onChange={setValues}
                    disabled={!isEditing()}
                />
            </Show>

            <ConfirmModal
                open={confirmDelete()}
                title="Delete record"
                message="This permanently deletes the record. Continue?"
                confirmLabel="Delete"
                danger
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(false,)}
            />
        </div>
    );
};

export default EntityRecordEdit;
